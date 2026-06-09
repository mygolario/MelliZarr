import { Router, Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

/**
 * Validate Iranian National Code (Melli Code)
 * Simple length and digit check for mock KYC Tier 1
 */
function isValidNationalCode(code: string): boolean {
  return /^\d{10}$/.test(code);
}

/**
 * Validate Iranian Mobile Number
 * Must be 11 digits and start with 09
 */
function isValidMobileNumber(mobile: string): boolean {
  return /^09\d{9}$/.test(mobile);
}

/**
 * POST /api/auth/register
 * Register a new user (KYC Tier 1) and create a fiat wallet.
 */
router.post('/register', async (req: Request, res: Response) => {
  const { first_name, last_name, national_code, mobile_number, sheba_number } = req.body;

  // 1. Basic validation
  if (!first_name || typeof first_name !== 'string' || first_name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'First name is required and must be a valid string.',
    });
  }

  if (!last_name || typeof last_name !== 'string' || last_name.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Last name is required and must be a valid string.',
    });
  }

  if (!national_code || !isValidNationalCode(national_code)) {
    return res.status(400).json({
      success: false,
      message: 'National code must be exactly 10 digits.',
    });
  }

  if (!mobile_number || !isValidMobileNumber(mobile_number)) {
    return res.status(400).json({
      success: false,
      message: 'Mobile number must be exactly 11 digits and start with 09.',
    });
  }

  if (sheba_number && (typeof sheba_number !== 'string' || sheba_number.length > 26)) {
    return res.status(400).json({
      success: false,
      message: 'Sheba number is invalid (must be a string up to 26 characters).',
    });
  }

  const client = await pool.connect();
  try {
    // 2. Start transaction
    await client.query('BEGIN');

    // 3. Check if user already exists with either national code or mobile number
    const existingUserQuery = `
      SELECT user_id, national_code, mobile_number 
      FROM users 
      WHERE national_code = $1 OR mobile_number = $2
    `;
    const existingUserRes = await client.query(existingUserQuery, [national_code, mobile_number]);

    if (existingUserRes.rows.length > 0) {
      const existing = existingUserRes.rows[0];
      let dupField = 'National Code or Mobile Number';
      if (existing.national_code === national_code && existing.mobile_number === mobile_number) {
        dupField = 'National Code and Mobile Number';
      } else if (existing.national_code === national_code) {
        dupField = 'National Code';
      } else {
        dupField = 'Mobile Number';
      }
      
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `${dupField} is already registered.`,
      });
    }

    // 4. Create the new user with KYC Tier 1 (verified name/national code/mobile mock)
    const insertUserQuery = `
      INSERT INTO users (national_code, mobile_number, first_name, last_name, kyc_tier, sheba_number, is_active)
      VALUES ($1, $2, $3, $4, 1, $5, TRUE)
      RETURNING user_id, national_code, mobile_number, first_name, last_name, kyc_tier, sheba_number, created_at
    `;
    const userRes = await client.query(insertUserQuery, [
      national_code,
      mobile_number,
      first_name.trim(),
      last_name.trim(),
      sheba_number || null,
    ]);
    const newUser = userRes.rows[0];

    // 5. Initialize user's fiat wallet with 0.00 IRR
    const insertWalletQuery = `
      INSERT INTO fiat_wallets (user_id, balance_irr)
      VALUES ($1, 0.00)
      RETURNING wallet_id, balance_irr
    `;
    const walletRes = await client.query(insertWalletQuery, [newUser.user_id]);
    const newWallet = walletRes.rows[0];

    // Commit transaction
    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'User registered successfully and Tier 1 KYC verified (mocked).',
      data: {
        user: newUser,
        wallet: {
          wallet_id: newWallet.wallet_id,
          balance_irr: parseFloat(newWallet.balance_irr),
        },
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'An internal error occurred during registration.',
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/auth/profile/:userId
 * Fetches user identity info and their current fiat wallet balance.
 */
router.get('/profile/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };
  
  // Validate UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    return res.status(400).json({ success: false, message: 'A valid userId UUID is required.' });
  }

  try {
    const profileQuery = `
      SELECT u.user_id, u.national_code, u.mobile_number, u.first_name, u.last_name, u.kyc_tier, u.sheba_number, u.is_active, u.created_at,
             COALESCE(w.balance_irr, 0.00) as balance_irr
      FROM users u
      LEFT JOIN fiat_wallets w ON u.user_id = w.user_id
      WHERE u.user_id = $1
    `;
    const result = await pool.query(profileQuery, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    
    const row = result.rows[0];
    return res.json({
      success: true,
      data: {
        user: {
          user_id: row.user_id,
          national_code: row.national_code,
          mobile_number: row.mobile_number,
          first_name: row.first_name,
          last_name: row.last_name,
          kyc_tier: row.kyc_tier,
          sheba_number: row.sheba_number,
          is_active: row.is_active,
          created_at: row.created_at,
        },
        balance_irr: parseFloat(row.balance_irr),
      }
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve user profile.',
    });
  }
});

export default router;

