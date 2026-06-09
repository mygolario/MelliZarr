import { Client } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const connectionString = process.env.DATABASE_URL;
const config = connectionString
  ? { connectionString }
  : {
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432'),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE || 'postgres',
    };

const SYSTEM_RESERVE_UUID = '00000000-0000-0000-0000-000000000000';
const DEMO_USER_UUID = 'd3b07384-d113-4956-a5cc-9c60dfd2948e';

async function main() {
  console.log('Connecting to the database for seeding...');
  const client = new Client(config);

  try {
    await client.connect();
    console.log('Connected successfully. Starting seed transaction...');

    // Begin transaction
    await client.query('BEGIN');

    // 1. Ensure System Reserve User exists
    console.log('Seeding System Reserve User...');
    await client.query(`
      INSERT INTO users (user_id, first_name, last_name, kyc_tier, is_active)
      VALUES ($1, 'System', 'Reserve Account', 2, TRUE)
      ON CONFLICT (user_id) DO NOTHING
    `, [SYSTEM_RESERVE_UUID]);

    // Create or Update System Reserve's Fiat Wallet
    console.log('Setting up System Reserve fiat wallet with 1,000,000,000 IRR...');
    const reserveWalletCheck = await client.query('SELECT wallet_id FROM fiat_wallets WHERE user_id = $1', [SYSTEM_RESERVE_UUID]);
    if (reserveWalletCheck.rows.length === 0) {
      await client.query(`
        INSERT INTO fiat_wallets (user_id, balance_irr)
        VALUES ($1, 1000000000.00)
      `, [SYSTEM_RESERVE_UUID]);
    } else {
      await client.query(`
        UPDATE fiat_wallets 
        SET balance_irr = 1000000000.00, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
      `, [SYSTEM_RESERVE_UUID]);
    }

    // 2. Ensure Demo User exists
    console.log('Seeding Demo User...');
    await client.query(`
      INSERT INTO users (user_id, national_code, mobile_number, first_name, last_name, kyc_tier, sheba_number, is_active)
      VALUES ($1, '0012345678', '09123456789', 'Ario', 'Demo', 1, 'IR123456789012345678901234', TRUE)
      ON CONFLICT (user_id) DO NOTHING
    `, [DEMO_USER_UUID]);

    // Create or Update Demo User's Fiat Wallet
    console.log('Setting up Demo User fiat wallet with 500,000,000 IRR...');
    const walletCheck = await client.query('SELECT wallet_id FROM fiat_wallets WHERE user_id = $1', [DEMO_USER_UUID]);
    if (walletCheck.rows.length === 0) {
      await client.query(`
        INSERT INTO fiat_wallets (user_id, balance_irr)
        VALUES ($1, 500000000.00)
      `, [DEMO_USER_UUID]);
    } else {
      await client.query(`
        UPDATE fiat_wallets 
        SET balance_irr = 500000000.00, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
      `, [DEMO_USER_UUID]);
    }

    // 3. Seed Gold Ledger (Double-Entry Logic)
    console.log('Seeding Gold Ledger...');

    // Transaction A: Inventory in-flow from Vault to SYSTEM_RESERVE
    // 10,000,000 mg (10 kg) of 24k gold, spot price 42,660 IRR/mg (42,660,000 IRR/g)
    console.log('Adding transaction: 10kg 24k gold from BONAKDAR_VAULT to SYSTEM_RESERVE...');
    await client.query(`
      INSERT INTO gold_ledger (transaction_id, from_account, to_account, gold_weight_mg, karat, tx_type, spot_price_per_mg_irr)
      VALUES ('TX_SEED_RESERVE_INIT_001', 'BONAKDAR_VAULT', 'SYSTEM_RESERVE', 10000000.000, 24, 'RESERVE_INVENTORY', 42660.00)
      ON CONFLICT (transaction_id) DO NOTHING
    `);

    // Transaction B: Demo user buys 50g (50,000 mg) of 18k gold from SYSTEM_RESERVE
    // Spot price 32,000 IRR/mg (32,000,000 IRR/g)
    const demoUserAccount = `USER_${DEMO_USER_UUID}`;
    console.log(`Adding transaction: 50g 18k gold from SYSTEM_RESERVE to ${demoUserAccount}...`);
    await client.query(`
      INSERT INTO gold_ledger (transaction_id, from_account, to_account, gold_weight_mg, karat, tx_type, spot_price_per_mg_irr)
      VALUES ('TX_SEED_DEMO_BUY_001', 'SYSTEM_RESERVE', $1, 50000.000, 18, 'BUY', 32000.00)
      ON CONFLICT (transaction_id) DO NOTHING
    `, [demoUserAccount]);

    // 4. Seed Multisig Requests
    console.log('Seeding Pending Multisig Requests...');
    
    // Request 1: MANUAL_LEDGER_ADJUSTMENT requested by Tech Founder (pre-approved by Tech)
    const ledgerPayload = {
      from_account: 'SYSTEM_RESERVE',
      to_account: `USER_${DEMO_USER_UUID}`,
      gold_weight_mg: 150000.0,
      karat: 24,
      tx_type: 'RESERVE_INVENTORY',
      spot_price_per_mg_irr: 42660.0
    };
    await client.query(`
      INSERT INTO multisig_requests (request_id, requested_by, action_type, action_payload, approved_by_tech, approved_by_biz, status)
      VALUES ('11111111-1111-1111-1111-111111111111', 'TECH_FOUNDER', 'MANUAL_LEDGER_ADJUSTMENT', $1, TRUE, FALSE, 'PENDING_APPROVAL')
      ON CONFLICT (request_id) DO NOTHING
    `, [JSON.stringify(ledgerPayload)]);

    // Request 2: BULK_WITHDRAWAL requested by Biz Founder (pre-approved by Biz)
    const withdrawalPayload = {
      user_id: DEMO_USER_UUID,
      amount_irr: 75000000.0 // 7.5 million Tomans (75,000,000 Rials)
    };
    await client.query(`
      INSERT INTO multisig_requests (request_id, requested_by, action_type, action_payload, approved_by_tech, approved_by_biz, status)
      VALUES ('22222222-2222-2222-2222-222222222222', 'BIZ_FOUNDER', 'BULK_WITHDRAWAL', $1, FALSE, TRUE, 'PENDING_APPROVAL')
      ON CONFLICT (request_id) DO NOTHING
    `, [JSON.stringify(withdrawalPayload)]);

    // Request 3: HEDGE_LIQUIDATION requested by Tech Founder (fully pending, both false)
    const hedgePayload = {
      asset: 'GOLD_FUTURE_HEX_06',
      liquidation_value_irr: 250000000.0
    };
    await client.query(`
      INSERT INTO multisig_requests (request_id, requested_by, action_type, action_payload, approved_by_tech, approved_by_biz, status)
      VALUES ('33333333-3333-3333-3333-333333333333', 'TECH_FOUNDER', 'HEDGE_LIQUIDATION', $1, FALSE, FALSE, 'PENDING_APPROVAL')
      ON CONFLICT (request_id) DO NOTHING
    `, [JSON.stringify(hedgePayload)]);

    // Commit the transactions
    await client.query('COMMIT');
    console.log('Database seeded successfully.');

    // 4. Print Summary for Verification
    console.log('\n--- Seed Verification Summary ---');
    
    const demoUserRes = await client.query('SELECT * FROM users WHERE user_id = $1', [DEMO_USER_UUID]);
    console.log('Demo User Info:', demoUserRes.rows[0]);

    const demoWalletRes = await client.query('SELECT balance_irr FROM fiat_wallets WHERE user_id = $1', [DEMO_USER_UUID]);
    console.log('Demo User Fiat Balance:', demoWalletRes.rows[0]?.balance_irr, 'IRR');

    // Calculate Demo User Gold Balance: (Credits to demoUserAccount) - (Debits from demoUserAccount)
    const goldBalanceRes = await client.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN to_account = $1 THEN gold_weight_mg ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN from_account = $1 THEN gold_weight_mg ELSE 0 END), 0) as gold_balance_mg
      FROM gold_ledger
    `, [demoUserAccount]);
    console.log('Demo User Gold Balance (18k):', goldBalanceRes.rows[0]?.gold_balance_mg, 'mg');

    // Calculate System Reserve Gold Balance for both 18k and 24k
    const reserveGold24k = await client.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN to_account = 'SYSTEM_RESERVE' THEN gold_weight_mg ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN from_account = 'SYSTEM_RESERVE' THEN gold_weight_mg ELSE 0 END), 0) as gold_balance_mg
      FROM gold_ledger
      WHERE karat = 24
    `);
    const reserveGold18k = await client.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN to_account = 'SYSTEM_RESERVE' THEN gold_weight_mg ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN from_account = 'SYSTEM_RESERVE' THEN gold_weight_mg ELSE 0 END), 0) as gold_balance_mg
      FROM gold_ledger
      WHERE karat = 18
    `);
    console.log('System Reserve Gold Balance (24k):', reserveGold24k.rows[0]?.gold_balance_mg, 'mg');
    console.log('System Reserve Gold Balance (18k):', reserveGold18k.rows[0]?.gold_balance_mg, 'mg');
    console.log('---------------------------------');

  } catch (error) {
    console.error('Error during seeding:', error);
    await client.query('ROLLBACK');
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed.');
  }
}

main();
