const { pool } = require('../utils/database');
const AppError = require('../utils/AppError');
const { PLANS } = require('../controllers/billingController');

/**
 * requirePlan(feature, options)
 *
 * Usage examples:
 *   requirePlan('cameras')           — checks camera count vs plan limit
 *   requirePlan('ai_intelligence')   — blocks if plan has no AI
 *   requirePlan('camera_liberation') — checks liberation count vs plan limit
 *   requirePlan('admins')            — checks admin count vs plan limit
 */
const requirePlan = (feature, options = {}) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new AppError('Authentication required', 401));

      const userResult = await pool.query(
        'SELECT plan, plan_expires_at FROM users WHERE id = $1',
        [userId]
      );
      const user = userResult.rows[0];
      const plan = user?.plan || 'free';

      // Check if paid plan has expired
      if (plan !== 'free' && user?.plan_expires_at) {
        const expired = new Date(user.plan_expires_at) < new Date();
        if (expired) {
          await pool.query(
            "UPDATE users SET plan = 'free', stripe_subscription_id = NULL WHERE id = $1",
            [userId]
          );
          return next(
            new AppError(
              'Your subscription has expired. Please renew to access this feature.',
              402
            )
          );
        }
      }

      const planConfig = PLANS[plan] || PLANS.free;
      const limit = planConfig[feature];

      // Boolean feature gate (e.g. ai_intelligence)
      if (typeof limit === 'boolean') {
        if (!limit) {
          return next(
            new AppError(
              `${feature.replace(/_/g, ' ')} requires a Pro or Business plan.`,
              403
            )
          );
        }
        req.planConfig = planConfig;
        return next();
      }

      // Numeric limit (-1 = unlimited)
      if (typeof limit === 'number') {
        if (limit === -1) {
          req.planConfig = planConfig;
          return next();
        }

        // Count current usage
        let currentCount = 0;

        if (feature === 'cameras') {
          const countResult = await pool.query(
            "SELECT COUNT(*) FROM devices WHERE owner_id = $1 AND status != 'deleted'",
            [userId]
          );
          currentCount = parseInt(countResult.rows[0].count, 10);
        }

        if (feature === 'admins') {
          const countResult = await pool.query(
            "SELECT COUNT(*) FROM organization_members WHERE owner_id = $1 AND role = 'admin'",
            [userId]
          );
          currentCount = parseInt(countResult.rows[0].count, 10);
        }

        if (feature === 'camera_liberation') {
          const countResult = await pool.query(
            `SELECT COUNT(*) FROM devices
             WHERE owner_id = $1
             AND liberated = true
             AND liberated_at > NOW() - INTERVAL '1 month'`,
            [userId]
          );
          currentCount = parseInt(countResult.rows[0].count, 10);
        }

        if (currentCount >= limit) {
          const upgradeMsg =
            plan === 'free'
              ? 'Upgrade to Pro to add more.'
              : plan === 'pro'
              ? 'Upgrade to Business for higher limits.'
              : 'Contact sales for Enterprise limits.';

          return next(
            new AppError(
              `You've reached your ${feature.replace(/_/g, ' ')} limit (${limit}) on the ${planConfig.name} plan. ${upgradeMsg}`,
              403
            )
          );
        }

        req.planConfig = planConfig;
        req.currentUsage = { [feature]: currentCount, limit };
        return next();
      }

      // Unknown feature — allow through but log
      req.planConfig = planConfig;
      next();
    } catch (err) {
      next(new AppError('Failed to verify plan limits', 500));
    }
  };
};

/**
 * attachPlan — lightweight middleware that just attaches plan info to req
 * Use on routes that need plan info but shouldn't block
 */
const attachPlan = async (req, res, next) => {
  try {
    if (!req.user?.id) return next();
    const result = await pool.query(
      'SELECT plan, plan_expires_at FROM users WHERE id = $1',
      [req.user.id]
    );
    const plan = result.rows[0]?.plan || 'free';
    req.plan = plan;
    req.planConfig = PLANS[plan] || PLANS.free;
    next();
  } catch (err) {
    next();
  }
};

module.exports = { requirePlan, attachPlan };
