-- =========================================================================
-- MelliZarr Database Initialization Script
-- Establishes the relational user base and double-entry gold ledger system.
-- =========================================================================

-- Enable UUID extension for secure, non-sequential IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table (Core Identity & KYC Status)
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    national_code VARCHAR(10) UNIQUE, -- Iranian National Code (Melli Code)
    mobile_number VARCHAR(11) UNIQUE, -- Must match National Code via Shahkar API
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    kyc_tier INT DEFAULT 0 CHECK (kyc_tier IN (0, 1, 2)),
    sheba_number VARCHAR(26),        -- Iranian bank Sheba account identifier
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Wallets Table (Fiat Balance Tracking)
CREATE TABLE fiat_wallets (
    wallet_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    balance_irr NUMERIC(15, 2) DEFAULT 0.00, -- Balance in Iranian Rials
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Double-Entry Gold Ledger Table
-- Tracks every physical and digital milligram movement with milligram-precision (0.001 mg)
CREATE TABLE gold_ledger (
    ledger_id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) UNIQUE NOT NULL,
    from_account VARCHAR(64) NOT NULL, -- e.g. 'SYSTEM_RESERVE', 'USER_uuid', 'BONAKDAR_VAULT'
    to_account VARCHAR(64) NOT NULL,   -- e.g. 'USER_uuid', 'SYSTEM_FEE_POOL', 'REDEMPTION_BURN'
    gold_weight_mg NUMERIC(12, 3) NOT NULL CHECK (gold_weight_mg > 0), -- Milligrams
    karat INT NOT NULL CHECK (karat IN (18, 24)),
    tx_type VARCHAR(30) NOT NULL, -- 'BUY', 'SELL', 'GIFT_P2P', 'REDEMPTION', 'RESERVE_INVENTORY'
    spot_price_per_mg_irr NUMERIC(12, 2) NOT NULL, -- Price reference at moment of trade
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indices for rapid query performance on balances and accounting audit checks
CREATE INDEX idx_gold_ledger_from ON gold_ledger(from_account);
CREATE INDEX idx_gold_ledger_to ON gold_ledger(to_account);

-- 4. Live Prices Table (Managed by ZarrOracle Agent)
CREATE TABLE live_prices (
    price_id SERIAL PRIMARY KEY,
    karat INT NOT NULL UNIQUE CHECK (karat IN (18, 24)),
    base_price_per_g_irr NUMERIC(12, 2) NOT NULL,
    ask_price_per_g_irr NUMERIC(12, 2) NOT NULL, -- Platform selling price
    bid_price_per_g_irr NUMERIC(12, 2) NOT NULL, -- Platform buying price
    spread_percentage NUMERIC(5, 2) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Physical Vault Inventory Logs (Managed by ZarrAudit Agent)
CREATE TABLE vault_inventory_logs (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vault_location VARCHAR(100) NOT NULL DEFAULT 'GRAND_BAZAAR_CENTRAL',
    gold_weight_grams NUMERIC(12, 3) NOT NULL,
    karat INT NOT NULL CHECK (karat IN (18, 24)),
    verified_by_founder VARCHAR(100) NOT NULL,
    audit_status VARCHAR(20) DEFAULT 'VERIFIED', -- 'VERIFIED', 'DISCREPANCY'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Co-Founder Admin Multisig Table
-- High-stakes financial/ledger transactions must sit here until approved by both keys.
CREATE TABLE multisig_requests (
    request_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requested_by VARCHAR(50) NOT NULL, -- 'TECH_FOUNDER' or 'BIZ_FOUNDER'
    action_type VARCHAR(50) NOT NULL,  -- 'MANUAL_LEDGER_ADJUSTMENT', 'BULK_WITHDRAWAL', 'HEDGE_LIQUIDATION'
    action_payload JSONB NOT NULL,     -- Contains database-executable payload parameters
    approved_by_tech BOOLEAN DEFAULT FALSE,
    approved_by_biz BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'PENDING_APPROVAL', -- 'PENDING_APPROVAL', 'EXECUTED', 'REJECTED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial system accounts for double-entry ledger logic
INSERT INTO users (user_id, first_name, last_name, kyc_tier, is_active)
VALUES 
    ('00000000-0000-0000-0000-000000000000', 'System', 'Reserve Account', 2, TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO live_prices (karat, base_price_per_g_irr, ask_price_per_g_irr, bid_price_per_g_irr, spread_percentage)
VALUES 
    (18, 32000000, 32384000, 31744000, 1.20),
    (24, 42660000, 43171920, 42318720, 1.20)
ON CONFLICT DO NOTHING;