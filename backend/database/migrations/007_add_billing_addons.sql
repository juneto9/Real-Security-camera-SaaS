-- Migration: 007_add_billing_addons.sql
-- Adds add-on packs, SSID tracking, overage, and optimization tables

BEGIN;

-- Add billing + usage columns to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS plan                        VARCHAR(20)   NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS plan_expires_at             TIMESTAMP,
  ADD COLUMN IF NOT EXISTS storage_used_gb             DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cameras_count               INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ssids_count                 INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS admins_count                INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS liberations_used_this_month INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clips_per_day_avg           DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storage_growth_gb_per_day   DECIMAL(10,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overage_grace_expires_at    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS overage_notified_at         TIMESTAMP;

-- User add-ons table
CREATE TABLE IF NOT EXISTS user_addons (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addon_id                    VARCHAR(50)   NOT NULL,
  addon_type                  VARCHAR(20)   NOT NULL, -- camera, ssid, storage, liberation, admin
  qty                         INTEGER       NOT NULL,
  price                       INTEGER       NOT NULL, -- in cents
  purchased_qty               INTEGER       NOT NULL, -- original qty when purchased
  avg_used_qty                DECIMAL(10,2) DEFAULT 0,
  recurring                   BOOLEAN       DEFAULT true,
  active                      BOOLEAN       DEFAULT true,
  purchased_at                TIMESTAMP     DEFAULT NOW(),
  optimization_notified_at    TIMESTAMP,
  optimization_pending_pack   VARCHAR(50),
  optimization_savings        INTEGER,      -- in cents
  optimization_apply_at       TIMESTAMP,
  optimization_applied_at     TIMESTAMP,
  stripe_subscription_item_id VARCHAR(255),
  created_at                  TIMESTAMP     DEFAULT NOW()
);

-- SSID registrations
CREATE TABLE IF NOT EXISTS user_ssids (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ssid            VARCHAR(255)  NOT NULL,
  physical_address TEXT,
  verified        BOOLEAN       DEFAULT false,
  verification_method VARCHAR(20) DEFAULT 'manual', -- agent, manual
  network_type    VARCHAR(20)   DEFAULT 'wpa2',     -- wpa2, wpa3
  is_flagged      BOOLEAN       DEFAULT false,
  flag_reason     VARCHAR(255),
  tos_accepted_at TIMESTAMP,
  tos_accepted_ip VARCHAR(45),
  active          BOOLEAN       DEFAULT true,
  created_at      TIMESTAMP     DEFAULT NOW(),
  UNIQUE(user_id, ssid)
);

-- Addon price map (maps addon_id to Stripe price ID)
CREATE TABLE IF NOT EXISTS addon_price_map (
  addon_id        VARCHAR(50)   PRIMARY KEY,
  stripe_price_id VARCHAR(255),
  created_at      TIMESTAMP     DEFAULT NOW()
);

-- Overage charge log
CREATE TABLE IF NOT EXISTS overage_charges (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  overage_type    VARCHAR(20)   NOT NULL, -- camera, ssid, storage, admin
  excess_qty      DECIMAL(10,2) NOT NULL,
  billed_qty      DECIMAL(10,2) NOT NULL,
  unit_price      INTEGER       NOT NULL, -- in cents
  total_charge    INTEGER       NOT NULL, -- in cents
  billing_period  VARCHAR(7),             -- YYYY-MM
  stripe_invoice_item_id VARCHAR(255),
  created_at      TIMESTAMP     DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id
  ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription_id
  ON users(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_addons_user_id
  ON user_addons(user_id);

CREATE INDEX IF NOT EXISTS idx_user_addons_optimization
  ON user_addons(optimization_apply_at)
  WHERE optimization_pending_pack IS NOT NULL AND optimization_applied_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_ssids_user_id
  ON user_ssids(user_id);

CREATE INDEX IF NOT EXISTS idx_overage_charges_user_id
  ON overage_charges(user_id);

-- Default all existing users to free plan
UPDATE users SET plan = 'free' WHERE plan IS NULL;

COMMIT;
