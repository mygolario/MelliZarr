import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db';

const router = Router();

const SYSTEM_RESERVE_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Validate UUID format
 */
function isValidUUID(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

/**
 * GET /api/gold/rates
 * Fetch the latest live gold rates.
 */
router.get('/rates', async (req: Request, res: Response) => {
  try {
    const ratesQuery = `
      SELECT karat, base_price_per_g_irr, ask_price_per_g_irr, bid_price_per_g_irr, spread_percentage, updated_at
      FROM live_prices
      ORDER BY karat ASC
    `;
    const result = await pool.query(ratesQuery);
    
    // Format numeric strings to floats for response clarity
    const rates = result.rows.map(row => ({
      karat: row.karat,
      base_price_per_g_irr: parseFloat(row.base_price_per_g_irr),
      ask_price_per_g_irr: parseFloat(row.ask_price_per_g_irr),
      bid_price_per_g_irr: parseFloat(row.bid_price_per_g_irr),
      spread_percentage: parseFloat(row.spread_percentage),
      updated_at: row.updated_at,
    }));

    return res.json({
      success: true,
      rates,
    });
  } catch (error) {
    console.error('Error fetching rates:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve live gold rates.',
    });
  }
});

/**
 * POST /api/gold/buy
 * Deducts IRR from user's wallet, calculates gold weight in mg, and writes double-entry ledger rows.
 */
router.post('/buy', async (req: Request, res: Response) => {
  const { user_id, karat, amount_irr, gold_weight_mg } = req.body;

  // 1. Parameter validations
  if (!user_id || !isValidUUID(user_id)) {
    return res.status(400).json({ success: false, message: 'A valid user_id UUID is required.' });
  }

  if (karat !== 18 && karat !== 24) {
    return res.status(400).json({ success: false, message: 'Karat must be either 18 or 24.' });
  }

  if (amount_irr !== undefined && gold_weight_mg !== undefined) {
    return res.status(400).json({
      success: false,
      message: 'Provide either amount_irr OR gold_weight_mg, not both.',
    });
  }

  if (amount_irr === undefined && gold_weight_mg === undefined) {
    return res.status(400).json({
      success: false,
      message: 'Either amount_irr OR gold_weight_mg must be specified.',
    });
  }

  const inputAmountIrr = amount_irr !== undefined ? parseFloat(amount_irr) : null;
  const inputWeightMg = gold_weight_mg !== undefined ? parseFloat(gold_weight_mg) : null;

  if ((inputAmountIrr !== null && (isNaN(inputAmountIrr) || inputAmountIrr <= 0)) ||
      (inputWeightMg !== null && (isNaN(inputWeightMg) || inputWeightMg <= 0))) {
    return res.status(400).json({
      success: false,
      message: 'The amount or weight must be a positive number.',
    });
  }

  const client = await pool.connect();

  try {
    // Start transaction
    await client.query('BEGIN');

    // 2. Verify user exists and is active
    const userCheck = await client.query('SELECT is_active, kyc_tier FROM users WHERE user_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (!userCheck.rows[0].is_active) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'User account is suspended or inactive.' });
    }

    // 3. Fetch current live rate for selected karat
    const rateCheck = await client.query('SELECT ask_price_per_g_irr FROM live_prices WHERE karat = $1', [karat]);
    if (rateCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ success: false, message: 'Gold price feed is currently unavailable.' });
    }

    const askPricePerGram = parseFloat(rateCheck.rows[0].ask_price_per_g_irr);
    const askPricePerMg = askPricePerGram / 1000.0; // 1g = 1000mg

    // Calculate final weight and amount
    let finalAmountIrr: number;
    let finalWeightMg: number;

    if (inputAmountIrr !== null) {
      finalAmountIrr = inputAmountIrr;
      finalWeightMg = finalAmountIrr / askPricePerMg;
    } else {
      finalWeightMg = inputWeightMg!;
      finalAmountIrr = finalWeightMg * askPricePerMg;
    }

    // Round according to DB specifications (money -> 2 decimal places, weight -> 3 decimal places)
    finalAmountIrr = Math.round(finalAmountIrr * 100) / 100;
    finalWeightMg = Math.round(finalWeightMg * 1000) / 1000;

    // 4. Enforce minimum investment guardrails (min 100,000 IRR or 1 mg)
    if (finalAmountIrr < 100000.00 || finalWeightMg < 1.0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Transaction is below the minimum investment limit (100,000 IRR or 1 mg gold).',
      });
    }

    // 5. Validate user fiat balance
    const userWalletRes = await client.query('SELECT balance_irr FROM fiat_wallets WHERE user_id = $1', [user_id]);
    if (userWalletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ success: false, message: 'User fiat wallet not initialized.' });
    }

    const userFiatBalance = parseFloat(userWalletRes.rows[0].balance_irr);
    if (userFiatBalance < finalAmountIrr) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Insufficient fiat balance. Required: ${finalAmountIrr} IRR, Available: ${userFiatBalance} IRR.`,
      });
    }

    // 6. Validate platform gold reserves (Double-entry check)
    // SYSTEM_RESERVE gold balance is (Sum of inflows) - (Sum of outflows)
    const reserveGoldQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN to_account = 'SYSTEM_RESERVE' THEN gold_weight_mg ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN from_account = 'SYSTEM_RESERVE' THEN gold_weight_mg ELSE 0 END), 0) as gold_balance_mg
      FROM gold_ledger
      WHERE karat = $1
    `;
    const reserveGoldRes = await client.query(reserveGoldQuery, [karat]);
    const reserveGoldBalance = parseFloat(reserveGoldRes.rows[0].gold_balance_mg);

    if (reserveGoldBalance < finalWeightMg) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'The platform gold reserve is currently insufficient to fulfill this order.',
      });
    }

    // 7. Perform updates
    // A. Deduct IRR from buyer's wallet
    const deductUserWallet = `
      UPDATE fiat_wallets
      SET balance_irr = balance_irr - $1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
      RETURNING balance_irr
    `;
    const updatedUserWalletRes = await client.query(deductUserWallet, [finalAmountIrr, user_id]);
    const newUserBalance = parseFloat(updatedUserWalletRes.rows[0].balance_irr);

    // B. Credit IRR to SYSTEM_RESERVE's wallet
    const creditReserveWallet = `
      UPDATE fiat_wallets
      SET balance_irr = balance_irr + $1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
    `;
    await client.query(creditReserveWallet, [finalAmountIrr, SYSTEM_RESERVE_UUID]);

    // C. Write double-entry ledger row
    const txId = `TX_BUY_${uuidv4()}`;
    const userAccount = `USER_${user_id}`;
    const insertLedgerQuery = `
      INSERT INTO gold_ledger (transaction_id, from_account, to_account, gold_weight_mg, karat, tx_type, spot_price_per_mg_irr)
      VALUES ($1, 'SYSTEM_RESERVE', $2, $3, $4, 'BUY', $5)
    `;
    await client.query(insertLedgerQuery, [txId, userAccount, finalWeightMg, karat, askPricePerMg]);

    // Commit transaction
    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Gold purchased successfully.',
      data: {
        transaction_id: txId,
        gold_weight_mg: finalWeightMg,
        amount_irr: finalAmountIrr,
        karat,
        spot_price_per_mg_irr: askPricePerMg,
        user_new_fiat_balance_irr: newUserBalance,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during gold buy transaction:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during the gold buy transaction.',
    });
  } finally {
    client.release();
  }
});

/**
 * POST /api/gold/sell
 * Deducts gold milligrams from user's account, calculates IRR, credits it to user, and updates ledger.
 */
router.post('/sell', async (req: Request, res: Response) => {
  const { user_id, karat, gold_weight_mg, amount_irr } = req.body;

  // 1. Parameter validations
  if (!user_id || !isValidUUID(user_id)) {
    return res.status(400).json({ success: false, message: 'A valid user_id UUID is required.' });
  }

  if (karat !== 18 && karat !== 24) {
    return res.status(400).json({ success: false, message: 'Karat must be either 18 or 24.' });
  }

  if (gold_weight_mg !== undefined && amount_irr !== undefined) {
    return res.status(400).json({
      success: false,
      message: 'Provide either gold_weight_mg OR amount_irr, not both.',
    });
  }

  if (gold_weight_mg === undefined && amount_irr === undefined) {
    return res.status(400).json({
      success: false,
      message: 'Either gold_weight_mg OR amount_irr must be specified.',
    });
  }

  const inputWeightMg = gold_weight_mg !== undefined ? parseFloat(gold_weight_mg) : null;
  const inputAmountIrr = amount_irr !== undefined ? parseFloat(amount_irr) : null;

  if ((inputWeightMg !== null && (isNaN(inputWeightMg) || inputWeightMg <= 0)) ||
      (inputAmountIrr !== null && (isNaN(inputAmountIrr) || inputAmountIrr <= 0))) {
    return res.status(400).json({
      success: false,
      message: 'The weight or amount must be a positive number.',
    });
  }

  const client = await pool.connect();

  try {
    // Start transaction
    await client.query('BEGIN');

    // 2. Verify user exists and is active
    const userCheck = await client.query('SELECT is_active, kyc_tier FROM users WHERE user_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (!userCheck.rows[0].is_active) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'User account is suspended or inactive.' });
    }

    // 3. Fetch current live rate for selected karat
    const rateCheck = await client.query('SELECT bid_price_per_g_irr FROM live_prices WHERE karat = $1', [karat]);
    if (rateCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ success: false, message: 'Gold price feed is currently unavailable.' });
    }

    const bidPricePerGram = parseFloat(rateCheck.rows[0].bid_price_per_g_irr);
    const bidPricePerMg = bidPricePerGram / 1000.0; // 1g = 1000mg

    // Calculate final weight and amount
    let finalWeightMg: number;
    let finalAmountIrr: number;

    if (inputWeightMg !== null) {
      finalWeightMg = inputWeightMg;
      finalAmountIrr = finalWeightMg * bidPricePerMg;
    } else {
      finalAmountIrr = inputAmountIrr!;
      finalWeightMg = finalAmountIrr / bidPricePerMg;
    }

    // Round according to DB specifications (money -> 2 decimal places, weight -> 3 decimal places)
    finalWeightMg = Math.round(finalWeightMg * 1000) / 1000;
    finalAmountIrr = Math.round(finalAmountIrr * 100) / 100;

    // Enforce minimum sell limit of 1 mg
    if (finalWeightMg < 1.0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'The minimum allowed sell weight is 1 milligram.',
      });
    }

    // 4. Validate user's gold balance (Double-entry calculation)
    const userAccount = `USER_${user_id}`;
    const userGoldQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN to_account = $1 THEN gold_weight_mg ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN from_account = $1 THEN gold_weight_mg ELSE 0 END), 0) as gold_balance_mg
      FROM gold_ledger
      WHERE karat = $2
    `;
    const userGoldRes = await client.query(userGoldQuery, [userAccount, karat]);
    const userGoldBalance = parseFloat(userGoldRes.rows[0].gold_balance_mg);

    if (userGoldBalance < finalWeightMg) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Insufficient gold balance. Required: ${finalWeightMg} mg, Available: ${userGoldBalance} mg.`,
      });
    }

    // 5. Validate platform reserve IRR liquidity
    const reserveWalletRes = await client.query('SELECT balance_irr FROM fiat_wallets WHERE user_id = $1', [SYSTEM_RESERVE_UUID]);
    if (reserveWalletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ success: false, message: 'Platform reserve wallet not initialized.' });
    }

    const reserveFiatBalance = parseFloat(reserveWalletRes.rows[0].balance_irr);
    if (reserveFiatBalance < finalAmountIrr) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Platform reserves have insufficient liquidity to fulfill this buyback at this time.',
      });
    }

    // 6. Perform updates
    // A. Deduct IRR from SYSTEM_RESERVE's wallet
    const deductReserveWallet = `
      UPDATE fiat_wallets
      SET balance_irr = balance_irr - $1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
    `;
    await client.query(deductReserveWallet, [finalAmountIrr, SYSTEM_RESERVE_UUID]);

    // B. Credit IRR to seller's wallet
    const creditUserWallet = `
      UPDATE fiat_wallets
      SET balance_irr = balance_irr + $1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
      RETURNING balance_irr
    `;
    const updatedUserWalletRes = await client.query(creditUserWallet, [finalAmountIrr, user_id]);
    const newUserBalance = parseFloat(updatedUserWalletRes.rows[0].balance_irr);

    // C. Write double-entry ledger row
    const txId = `TX_SELL_${uuidv4()}`;
    const insertLedgerQuery = `
      INSERT INTO gold_ledger (transaction_id, from_account, to_account, gold_weight_mg, karat, tx_type, spot_price_per_mg_irr)
      VALUES ($1, $2, 'SYSTEM_RESERVE', $3, $4, 'SELL', $5)
    `;
    await client.query(insertLedgerQuery, [txId, userAccount, finalWeightMg, karat, bidPricePerMg]);

    // Commit transaction
    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Gold sold successfully.',
      data: {
        transaction_id: txId,
        gold_weight_mg: finalWeightMg,
        amount_irr: finalAmountIrr,
        karat,
        spot_price_per_mg_irr: bidPricePerMg,
        user_new_fiat_balance_irr: newUserBalance,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during gold sell transaction:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during the gold sell transaction.',
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/gold/balance/:userId
 * Calculates user's gold balances (18k & 24k) and lists transaction history.
 */
router.get('/balance/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };

  if (!userId || !isValidUUID(userId)) {
    return res.status(400).json({ success: false, message: 'A valid userId UUID is required.' });
  }

  const userAccount = `USER_${userId}`;

  try {
    // 1. Calculate gold balances for both 18k and 24k
    const balanceQuery = `
      SELECT 
        karat,
        COALESCE(SUM(CASE WHEN to_account = $1 THEN gold_weight_mg ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN from_account = $1 THEN gold_weight_mg ELSE 0 END), 0) as balance_mg
      FROM gold_ledger
      WHERE to_account = $1 OR from_account = $1
      GROUP BY karat
    `;
    const balanceResult = await pool.query(balanceQuery, [userAccount]);

    let balance18k = 0;
    let balance24k = 0;

    for (const row of balanceResult.rows) {
      if (row.karat === 18) balance18k = parseFloat(row.balance_mg);
      if (row.karat === 24) balance24k = parseFloat(row.balance_mg);
    }

    // 2. Fetch the 20 most recent transactions
    const txQuery = `
      SELECT transaction_id, from_account, to_account, gold_weight_mg, karat, tx_type, spot_price_per_mg_irr, created_at
      FROM gold_ledger
      WHERE from_account = $1 OR to_account = $1
      ORDER BY created_at DESC
      LIMIT 20
    `;
    const txResult = await pool.query(txQuery, [userAccount]);

    const transactions = txResult.rows.map(row => ({
      transaction_id: row.transaction_id,
      from_account: row.from_account,
      to_account: row.to_account,
      gold_weight_mg: parseFloat(row.gold_weight_mg),
      karat: row.karat,
      tx_type: row.tx_type,
      spot_price_per_mg_irr: parseFloat(row.spot_price_per_mg_irr),
      created_at: row.created_at,
    }));

    return res.json({
      success: true,
      data: {
        balances: {
          karat18_mg: balance18k,
          karat24_mg: balance24k,
        },
        transactions,
      }
    });
  } catch (error) {
    console.error('Error fetching gold balance/ledger:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve gold balances and ledger history.',
    });
  }
});

/**
 * GET /api/gold/prices/history
 * Generates mock 24-hour historical rates for 18k and 24k based on current base prices.
 */
router.get('/prices/history', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT karat, base_price_per_g_irr FROM live_prices');
    let base18k = 32000000;
    let base24k = 42660000;

    for (const row of result.rows) {
      if (row.karat === 18) base18k = parseFloat(row.base_price_per_g_irr);
      if (row.karat === 24) base24k = parseFloat(row.base_price_per_g_irr);
    }

    const history = [];
    const now = new Date();

    for (let i = 24; i >= 0; i--) {
      const time = new Date(now.getTime() - i * 60 * 60 * 1000);
      const change18k = Math.sin(i * 0.5) * 150000 + (Math.cos(i * 0.2) * 50000) - (i * 10000);
      const change24k = Math.sin(i * 0.5 + 1) * 200000 + (Math.cos(i * 0.2) * 80000) - (i * 15000);

      history.push({
        timestamp: time.toISOString(),
        rate18k: Math.round((base18k + change18k) * 100) / 100,
        rate24k: Math.round((base24k + change24k) * 100) / 100,
      });
    }

    return res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error('Error generating price history:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve gold price history.',
    });
  }
});

/**
 * POST /api/gold/gift
 * Transfers gold from one user to another (P2P Gift) using the double-entry ledger.
 */
router.post('/gift', async (req: Request, res: Response) => {
  const { sender_id, recipient_mobile, karat, gold_weight_mg } = req.body;

  // 1. Validations
  if (!sender_id || !isValidUUID(sender_id)) {
    return res.status(400).json({ success: false, message: 'A valid sender_id UUID is required.' });
  }

  if (!recipient_mobile || !/^09\d{9}$/.test(recipient_mobile)) {
    return res.status(400).json({ success: false, message: 'Recipient mobile number is invalid (must be 11 digits starting with 09).' });
  }

  if (karat !== 18 && karat !== 24) {
    return res.status(400).json({ success: false, message: 'Karat must be either 18 or 24.' });
  }

  const weightMg = parseFloat(gold_weight_mg);
  if (isNaN(weightMg) || weightMg <= 0) {
    return res.status(400).json({ success: false, message: 'Gold weight in mg must be a positive number.' });
  }

  if (weightMg < 1.0) {
    return res.status(400).json({ success: false, message: 'The minimum allowed transfer weight is 1 milligram.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 2. Verify sender exists and is active
    const senderCheck = await client.query('SELECT is_active FROM users WHERE user_id = $1', [sender_id]);
    if (senderCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Sender not found.' });
    }
    if (!senderCheck.rows[0].is_active) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Sender account is suspended or inactive.' });
    }

    // 3. Verify sender has sufficient gold balance
    const senderAccount = `USER_${sender_id}`;
    const balanceQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN to_account = $1 THEN gold_weight_mg ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN from_account = $1 THEN gold_weight_mg ELSE 0 END), 0) as balance_mg
      FROM gold_ledger
      WHERE (to_account = $1 OR from_account = $1) AND karat = $2
    `;
    const balanceResult = await client.query(balanceQuery, [senderAccount, karat]);
    const senderBalance = parseFloat(balanceResult.rows[0]?.balance_mg || '0');

    if (senderBalance < weightMg) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Insufficient gold balance. Required: ${weightMg} mg, Available: ${senderBalance} mg.`,
      });
    }

    // 4. Find recipient by mobile number
    const recipientResult = await client.query(
      'SELECT user_id, first_name, last_name, is_active FROM users WHERE mobile_number = $1',
      [recipient_mobile]
    );

    if (recipientResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: `Recipient with mobile number ${recipient_mobile} is not registered on MelliZarr.`,
      });
    }

    const recipient = recipientResult.rows[0];
    if (!recipient.is_active) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Recipient account is suspended or inactive.' });
    }

    if (recipient.user_id === sender_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'You cannot gift gold to yourself.' });
    }

    // 5. Get current spot price to record in the transaction
    const priceResult = await client.query('SELECT ask_price_per_g_irr FROM live_prices WHERE karat = $1', [karat]);
    if (priceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ success: false, message: 'Live gold price feed is currently unavailable.' });
    }
    const askPricePerGram = parseFloat(priceResult.rows[0].ask_price_per_g_irr);
    const askPricePerMg = askPricePerGram / 1000.0;

    // 6. Execute transfer (Insert single double-entry row)
    const txId = `TX_GIFT_${uuidv4()}`;
    const recipientAccount = `USER_${recipient.user_id}`;
    
    const insertLedgerQuery = `
      INSERT INTO gold_ledger (transaction_id, from_account, to_account, gold_weight_mg, karat, tx_type, spot_price_per_mg_irr)
      VALUES ($1, $2, $3, $4, $5, 'GIFT_P2P', $6)
    `;
    await client.query(insertLedgerQuery, [txId, senderAccount, recipientAccount, weightMg, karat, askPricePerMg]);

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Gold gifted successfully.',
      data: {
        transaction_id: txId,
        recipient_name: `${recipient.first_name} ${recipient.last_name}`,
        recipient_mobile,
        gold_weight_mg: weightMg,
        karat,
        spot_price_per_mg_irr: askPricePerMg,
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during P2P gold gift transaction:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during the P2P gift transaction.',
    });
  } finally {
    client.release();
  }
});

export default router;

