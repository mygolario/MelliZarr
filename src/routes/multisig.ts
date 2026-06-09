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
 * GET /api/multisig/requests
 * Fetches all multisig requests, ordered by status (pending first) and creation date.
 */
router.get('/requests', async (req: Request, res: Response) => {
  try {
    const queryStr = `
      SELECT request_id, requested_by, action_type, action_payload, approved_by_tech, approved_by_biz, status, created_at, updated_at
      FROM multisig_requests
      ORDER BY 
        CASE WHEN status = 'PENDING_APPROVAL' THEN 1 ELSE 2 END ASC,
        created_at DESC
    `;
    const result = await pool.query(queryStr);
    return res.json({
      success: true,
      requests: result.rows,
    });
  } catch (error) {
    console.error('Error fetching multisig requests:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve multisig requests.',
    });
  }
});

/**
 * POST /api/multisig/request
 * Submits a new multisig request.
 */
router.post('/request', async (req: Request, res: Response) => {
  const { requested_by, action_type, action_payload } = req.body;

  if (!requested_by || (requested_by !== 'TECH_FOUNDER' && requested_by !== 'BIZ_FOUNDER')) {
    return res.status(400).json({
      success: false,
      message: "requested_by must be 'TECH_FOUNDER' or 'BIZ_FOUNDER'.",
    });
  }

  if (!action_type || !['MANUAL_LEDGER_ADJUSTMENT', 'BULK_WITHDRAWAL', 'HEDGE_LIQUIDATION'].includes(action_type)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid action_type.',
    });
  }

  if (!action_payload || typeof action_payload !== 'object') {
    return res.status(400).json({
      success: false,
      message: 'action_payload must be a valid JSON object.',
    });
  }

  // Pre-approve the creator's role
  const approved_by_tech = requested_by === 'TECH_FOUNDER';
  const approved_by_biz = requested_by === 'BIZ_FOUNDER';

  try {
    const insertQuery = `
      INSERT INTO multisig_requests (requested_by, action_type, action_payload, approved_by_tech, approved_by_biz, status)
      VALUES ($1, $2, $3, $4, $5, 'PENDING_APPROVAL')
      RETURNING *
    `;
    const result = await pool.query(insertQuery, [
      requested_by,
      action_type,
      JSON.stringify(action_payload),
      approved_by_tech,
      approved_by_biz,
    ]);

    return res.status(201).json({
      success: true,
      message: 'Multisig request submitted successfully.',
      request: result.rows[0],
    });
  } catch (error) {
    console.error('Error creating multisig request:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create multisig request.',
    });
  }
});

/**
 * POST /api/multisig/approve
 * Approves a multisig request. Executes the transaction if both approved.
 */
router.post('/approve', async (req: Request, res: Response) => {
  const { request_id, admin_type } = req.body;

  if (!request_id || !isValidUUID(request_id)) {
    return res.status(400).json({ success: false, message: 'A valid request_id UUID is required.' });
  }

  if (admin_type !== 'tech' && admin_type !== 'biz') {
    return res.status(400).json({ success: false, message: "admin_type must be 'tech' or 'biz'." });
  }

  const client = await pool.connect();
  try {
    // 1. Fetch current status of request inside transaction
    await client.query('BEGIN');

    const checkQuery = `
      SELECT request_id, requested_by, action_type, action_payload, approved_by_tech, approved_by_biz, status
      FROM multisig_requests
      WHERE request_id = $1
      FOR UPDATE
    `;
    const checkRes = await client.query(checkQuery, [request_id]);

    if (checkRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Multisig request not found.' });
    }

    const request = checkRes.rows[0];

    if (request.status !== 'PENDING_APPROVAL') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `This request cannot be approved because its status is ${request.status}.`,
      });
    }

    // 2. Set approval flag
    let nextTech = request.approved_by_tech;
    let nextBiz = request.approved_by_biz;

    if (admin_type === 'tech') {
      nextTech = true;
    } else {
      nextBiz = true;
    }

    const bothApproved = nextTech && nextBiz;

    if (bothApproved) {
      // 3. EXECUTE TARGET DATABASE UPDATE
      const payload = typeof request.action_payload === 'string' 
        ? JSON.parse(request.action_payload) 
        : request.action_payload;

      if (request.action_type === 'MANUAL_LEDGER_ADJUSTMENT') {
        const { from_account, to_account, gold_weight_mg, karat, tx_type, spot_price_per_mg_irr } = payload;

        if (!from_account || !to_account || !gold_weight_mg || !karat || !tx_type || !spot_price_per_mg_irr) {
          throw new Error('Incomplete action payload for MANUAL_LEDGER_ADJUSTMENT.');
        }

        // Insert double-entry ledger row
        const txId = `TX_MANUAL_${uuidv4()}`;
        const insertLedger = `
          INSERT INTO gold_ledger (transaction_id, from_account, to_account, gold_weight_mg, karat, tx_type, spot_price_per_mg_irr)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        await client.query(insertLedger, [
          txId,
          from_account,
          to_account,
          parseFloat(gold_weight_mg),
          parseInt(karat),
          tx_type,
          parseFloat(spot_price_per_mg_irr),
        ]);
        
        console.log(`Executed MANUAL_LEDGER_ADJUSTMENT for request ${request_id}. TX: ${txId}`);

      } else if (request.action_type === 'BULK_WITHDRAWAL') {
        const { user_id, amount_irr } = payload;

        if (!user_id || !isValidUUID(user_id) || amount_irr === undefined) {
          throw new Error('Incomplete action payload for BULK_WITHDRAWAL.');
        }

        const withdrawAmount = parseFloat(amount_irr);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
          throw new Error('Invalid withdrawal amount.');
        }

        // Check user fiat balance
        const balanceRes = await client.query('SELECT balance_irr FROM fiat_wallets WHERE user_id = $1 FOR UPDATE', [user_id]);
        if (balanceRes.rows.length === 0) {
          throw new Error('User fiat wallet not found.');
        }

        const userBalance = parseFloat(balanceRes.rows[0].balance_irr);
        if (userBalance < withdrawAmount) {
          throw new Error(`Insufficient user fiat balance. Required: ${withdrawAmount} IRR, Available: ${userBalance} IRR.`);
        }

        // Deduct from user
        const deductQuery = `
          UPDATE fiat_wallets
          SET balance_irr = balance_irr - $1, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $2
        `;
        await client.query(deductQuery, [withdrawAmount, user_id]);

        // Credit system reserve wallet
        const creditQuery = `
          UPDATE fiat_wallets
          SET balance_irr = balance_irr + $1, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $2
        `;
        await client.query(creditQuery, [withdrawAmount, SYSTEM_RESERVE_UUID]);

        console.log(`Executed BULK_WITHDRAWAL of ${withdrawAmount} IRR from user ${user_id} for request ${request_id}.`);

      } else if (request.action_type === 'HEDGE_LIQUIDATION') {
        // Mock execution for Hedge Liquidation
        console.log(`Executed HEDGE_LIQUIDATION for request ${request_id}.`);
      } else {
        throw new Error(`Unknown action type: ${request.action_type}`);
      }

      // Update request status to EXECUTED
      const updateRequest = `
        UPDATE multisig_requests
        SET approved_by_tech = $1, approved_by_biz = $2, status = 'EXECUTED', updated_at = CURRENT_TIMESTAMP
        WHERE request_id = $3
        RETURNING *
      `;
      const updateRes = await client.query(updateRequest, [nextTech, nextBiz, request_id]);
      
      await client.query('COMMIT');
      return res.json({
        success: true,
        message: 'Request approved and executed successfully.',
        request: updateRes.rows[0],
      });

    } else {
      // Just update approval flags, keep status as PENDING_APPROVAL
      const updateRequest = `
        UPDATE multisig_requests
        SET approved_by_tech = $1, approved_by_biz = $2, updated_at = CURRENT_TIMESTAMP
        WHERE request_id = $3
        RETURNING *
      `;
      const updateRes = await client.query(updateRequest, [nextTech, nextBiz, request_id]);
      
      await client.query('COMMIT');
      return res.json({
        success: true,
        message: 'Approval recorded successfully.',
        request: updateRes.rows[0],
      });
    }

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error during multisig approval/execution:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'An error occurred during approval processing.',
    });
  } finally {
    client.release();
  }
});

export default router;
