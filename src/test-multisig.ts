import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

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

async function runTest() {
  console.log('--- Programmatic Multisig Execution Test ---');
  const client = new Client(config);
  await client.connect();

  try {
    // 1. Reset any test entries
    await client.query("DELETE FROM multisig_requests WHERE request_id IN ('11111111-1111-1111-1111-111111111111')");
    
    // Reset user balances
    await client.query("UPDATE fiat_wallets SET balance_irr = 500000000.00 WHERE user_id = $1", [DEMO_USER_UUID]);
    await client.query("UPDATE fiat_wallets SET balance_irr = 1000000000.00 WHERE user_id = $1", [SYSTEM_RESERVE_UUID]);
    await client.query("DELETE FROM gold_ledger WHERE transaction_id LIKE 'TX_MANUAL_TEST%'");
    
    // 2. Insert fresh test requests
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
    `, [JSON.stringify(ledgerPayload)]);

    console.log('Seeded request 1: MANUAL_LEDGER_ADJUSTMENT, approved by Tech=true, Biz=false.');

    // 3. Test approval endpoint logic (simulate Tech approving, then Biz approving)
    console.log('Approving as Biz (admin_type=biz) to trigger execution...');
    
    // Call DB update to set approved_by_biz = true, check both approved
    const checkRes = await client.query(`
      SELECT request_id, action_payload, approved_by_tech, approved_by_biz, status
      FROM multisig_requests WHERE request_id = '11111111-1111-1111-1111-111111111111'
    `);
    const request = checkRes.rows[0];
    let nextTech = request.approved_by_tech;
    let nextBiz = true; // Simulating Biz approval click
    
    if (nextTech && nextBiz) {
      console.log('Both approved! Simulating Postgres transaction execution...');
      await client.query('BEGIN');
      
      const payload = typeof request.action_payload === 'string' 
        ? JSON.parse(request.action_payload) 
        : request.action_payload;
      
      // Execute ledger insertion
      const txId = `TX_MANUAL_TEST_${uuidv4().substring(0,8)}`;
      await client.query(`
        INSERT INTO gold_ledger (transaction_id, from_account, to_account, gold_weight_mg, karat, tx_type, spot_price_per_mg_irr)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        txId,
        payload.from_account,
        payload.to_account,
        payload.gold_weight_mg,
        payload.karat,
        payload.tx_type,
        payload.spot_price_per_mg_irr
      ]);

      await client.query(`
        UPDATE multisig_requests
        SET approved_by_tech = $1, approved_by_biz = $2, status = 'EXECUTED', updated_at = CURRENT_TIMESTAMP
        WHERE request_id = '11111111-1111-1111-1111-111111111111'
      `, [nextTech, nextBiz]);

      await client.query('COMMIT');
      console.log(`Transaction successfully executed! Ledger Row Inserted with TX ID: ${txId}`);
    }

    // Verify DB update
    const verifyRes = await client.query(`
      SELECT status, approved_by_biz, approved_by_tech FROM multisig_requests 
      WHERE request_id = '11111111-1111-1111-1111-111111111111'
    `);
    console.log('Verification Request Status:', verifyRes.rows[0]);

    // Verify Ledger row
    const ledgerVerify = await client.query(`
      SELECT * FROM gold_ledger WHERE to_account = $1 AND tx_type = 'RESERVE_INVENTORY'
    `, [`USER_${DEMO_USER_UUID}`]);
    console.log('Verified Ledger Row Count:', ledgerVerify.rows.length);
    console.log('Ledger Row Weight:', ledgerVerify.rows[0]?.gold_weight_mg, 'mg');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Test execution failed:', error);
  } finally {
    await client.end();
    console.log('Database connection closed.');
  }
}

runTest();
