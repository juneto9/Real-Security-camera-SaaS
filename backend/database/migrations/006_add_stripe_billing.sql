-- Migration: 006_add_stripe_billing.sql
-- Adds Stripe billing columns to users table
-- Run: node database/migrations/migrate.js

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS plan                   VARCHAR(20)  NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS plan_expires_at        TIMESTAMP;

-- Index for webhook lookups by stripe_customer_id
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id
  ON users(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Index for subscription lookups
CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription_id
  ON users(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Ensure all existing users default to free plan
UPDATE users SET plan = 'free' WHERE plan IS NULL;

COMMIT;
