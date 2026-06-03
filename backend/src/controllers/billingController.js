const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../utils/database');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// PLAN DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────
const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    cameras: 2,
    ssids: 1,
    retention_days: 7,
    storage_gb: 5,
    storage_hard_cap_gb: 25,
    ai_intelligence: false,
    liberations_per_month: 0,
    liberation_price: 999,        // $9.99 one-time
    admins: 1,
    stripe_price_id: null,
    overage_camera_price: null,   // hard block — must upgrade
    overage_ssid_price: 299,      // $2.99/SSID/mo
    overage_storage_price: 99,    // $0.99/GB (billed in 5GB chunks)
  },
  pro: {
    name: 'Pro',
    price: 1999,                  // $19.99/mo
    cameras: 10,
    ssids: 3,
    retention_days: 60,
    storage_gb: 50,
    storage_soft_cap_gb: 500,
    ai_intelligence: true,
    ai_features: ['person_detection', 'pet_detection', 'smart_notifications'],
    liberations_per_month: 3,
    liberation_price: 499,        // $4.99 one-time after included
    admins: 2,
    stripe_price_id: process.env.STRIPE_PRO_PRICE_ID,
    overage_camera_price: null,   // hard block on base plan
    overage_ssid_price: 299,      // $2.99/SSID/mo
    overage_storage_price: 49,    // $0.49/GB (billed in 5GB chunks)
  },
  business: {
    name: 'Business',
    price: 4999,                  // $49.99/mo
    cameras: 25,
    ssids: 10,
    retention_days: 180,
    storage_gb: 250,
    storage_soft_cap_gb: 2048,    // 2TB
    ai_intelligence: true,
    ai_features: ['person_detection', 'pet_detection', 'smart_notifications', 'facial_recognition', 'schedule_awareness'],
    liberations_per_month: 10,
    liberation_price: 299,        // $2.99 one-time after included
    admins: 5,
    stripe_price_id: process.env.STRIPE_BUSINESS_PRICE_ID,
    overage_camera_price: 299,    // $2.99/camera/mo
    overage_ssid_price: 199,      // $1.99/SSID/mo
    overage_storage_price: 39,    // $0.39/GB (billed in 5GB chunks)
    overage_admin_price: 499,     // $4.99/admin/mo
  },
  enterprise: {
    name: 'Enterprise',
    price: 9999,                  // $99.99/mo
    cameras: 50,
    ssids: 50,
    retention_days: 365,
    storage_gb: 1024,             // 1TB
    storage_soft_cap_gb: null,    // no hard cap
    ai_intelligence: true,
    ai_features: ['person_detection', 'pet_detection', 'smart_notifications', 'facial_recognition', 'schedule_awareness', 'custom_model_training'],
    liberations_per_month: -1,    // unlimited
    liberation_price: 0,          // included
    admins: 10,
    stripe_price_id: process.env.STRIPE_ENTERPRISE_PRICE_ID,
    overage_camera_price: 199,    // $1.99/camera/mo
    overage_ssid_price: 99,       // $0.99/SSID/mo
    overage_storage_price: 33,    // $0.33/GB (billed in 5GB chunks)
    overage_admin_price: 399,     // $3.99/admin/mo
    white_label_price: 19999,     // $199.99/mo add-on
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ADD-ON PACKS
// ─────────────────────────────────────────────────────────────────────────────
const ADDON_PACKS = {
  // Camera packs
  camera_1:   { type: 'camera', qty: 1,  price: 299,   name: '+1 Camera',    recurring: true,  tiers: ['free','pro','business','enterprise'] },
  camera_2:   { type: 'camera', qty: 2,  price: 499,   name: '+2 Cameras',   recurring: true,  tiers: ['free','pro','business','enterprise'] },
  camera_5:   { type: 'camera', qty: 5,  price: 999,   name: '+5 Cameras',   recurring: true,  tiers: ['free','pro','business','enterprise'] },
  camera_10:  { type: 'camera', qty: 10, price: 1799,  name: '+10 Cameras',  recurring: true,  tiers: ['business','enterprise'] },
  camera_25:  { type: 'camera', qty: 25, price: 3999,  name: '+25 Cameras',  recurring: true,  tiers: ['enterprise'] },

  // SSID packs
  ssid_1:     { type: 'ssid',   qty: 1,  price: 299,   name: '+1 SSID',      recurring: true,  tiers: ['free','pro','business','enterprise'] },
  ssid_2:     { type: 'ssid',   qty: 2,  price: 499,   name: '+2 SSIDs',     recurring: true,  tiers: ['free','pro','business','enterprise'] },
  ssid_3:     { type: 'ssid',   qty: 3,  price: 699,   name: '+3 SSIDs',     recurring: true,  tiers: ['free','pro','business','enterprise'] },
  ssid_10:    { type: 'ssid',   qty: 10, price: 1499,  name: '+10 SSIDs',    recurring: true,  tiers: ['business','enterprise'] },

  // Storage packs
  storage_10:  { type: 'storage', qty: 10,  price: 499,   name: '+10 GB',   recurring: true,  tiers: ['free','pro','business','enterprise'] },
  storage_25:  { type: 'storage', qty: 25,  price: 999,   name: '+25 GB',   recurring: true,  tiers: ['free','pro','business','enterprise'] },
  storage_50:  { type: 'storage', qty: 50,  price: 1799,  name: '+50 GB',   recurring: true,  tiers: ['pro','business','enterprise'] },
  storage_100: { type: 'storage', qty: 100, price: 2999,  name: '+100 GB',  recurring: true,  tiers: ['pro','business','enterprise'] },
  storage_500: { type: 'storage', qty: 500, price: 9999,  name: '+500 GB',  recurring: true,  tiers: ['business','enterprise'] },

  // Liberation packs (one-time)
  liberation_5:  { type: 'liberation', qty: 5,  price: 1999,  name: '+5 Liberations',   recurring: false, tiers: ['free','pro','business','enterprise'] },
  liberation_10: { type: 'liberation', qty: 10, price: 3499,  name: '+10 Liberations',  recurring: false, tiers: ['free','pro','business','enterprise'] },
  liberation_25: { type: 'liberation', qty: 25, price: 7499,  name: '+25 Liberations',  recurring: false, tiers: ['free','pro','business','enterprise'] },
};

// ─────────────────────────────────────────────────────────────────────────────
// LIFE EVENT BUNDLES
// ─────────────────────────────────────────────────────────────────────────────
const BUNDLES = {
  new_home: {
    name: 'New Home Bundle',
    description: '+1 SSID, +5 cameras, +25 GB storage',
    price: 1499,   // saves $3 vs separate
    recurring: true,
    includes: { cameras: 5, ssids: 1, storage_gb: 25 },
    tiers: ['free','pro','business','enterprise'],
    stripe_price_id: process.env.STRIPE_BUNDLE_NEW_HOME_ID,
  },
  small_business: {
    name: 'Small Business Starter Bundle',
    description: '+1 SSID, +10 cameras, +100 GB storage',
    price: 2499,   // saves $8 vs separate
    recurring: true,
    includes: { cameras: 10, ssids: 1, storage_gb: 100 },
    tiers: ['business','enterprise'],
    stripe_price_id: process.env.STRIPE_BUNDLE_SMALL_BIZ_ID,
  },
  dorm_rental: {
    name: 'Dorm / Rental Bundle',
    description: '+1 SSID, +3 cameras, +25 GB storage',
    price: 799,    // saves $2 vs separate
    recurring: true,
    includes: { cameras: 3, ssids: 1, storage_gb: 25 },
    tiers: ['free','pro','business','enterprise'],
    stripe_price_id: process.env.STRIPE_BUNDLE_DORM_ID,
  },
  vacation_home: {
    name: 'Vacation Home Bundle',
    description: '+1 SSID, +5 cameras, +25 GB storage',
    price: 999,    // saves $3 vs separate
    recurring: true,
    includes: { cameras: 5, ssids: 1, storage_gb: 25 },
    tiers: ['free','pro','business','enterprise'],
    stripe_price_id: process.env.STRIPE_BUNDLE_VACATION_ID,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// OVERAGE + GRACE PERIOD CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_CHUNK_GB = 5;       // bill in 5GB chunks
const GRACE_PERIOD_DAYS = 3;      // base 72hr grace
const OPTIMIZATION_DAYS = 60;     // check add-on usage after 60 days
const OPTIMIZATION_NOTICE_DAYS = 14; // 14 days to respond before auto-downsize
const OPTIMIZATION_THRESHOLD = 0.6;  // trigger if using < 60% of pack

// Grace period based on usage velocity
const getGracePeriodHours = (clipsPerDay, storageGrowthGbPerDay) => {
  if (storageGrowthGbPerDay > 5 || clipsPerDay > 50) return 24;
  if (storageGrowthGbPerDay > 1 || clipsPerDay > 10) return 48;
  return 72;
};

// Round up to nearest 5GB chunk
const roundUpToChunk = (gb) => Math.ceil(gb / STORAGE_CHUNK_GB) * STORAGE_CHUNK_GB;

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/billing/plans
const getPlans = (req, res) => {
  const publicPlans = Object.entries(PLANS).map(([key, plan]) => ({
    id: key,
    name: plan.name,
    price: plan.price,
    cameras: plan.cameras,
    ssids: plan.ssids,
    retention_days: plan.retention_days,
    storage_gb: plan.storage_gb,
    ai_intelligence: plan.ai_intelligence,
    ai_features: plan.ai_features || [],
    liberations_per_month: plan.liberations_per_month,
    liberation_price: plan.liberation_price,
    admins: plan.admins,
    overage_camera_price: plan.overage_camera_price,
    overage_ssid_price: plan.overage_ssid_price,
    overage_storage_price: plan.overage_storage_price,
  }));
  res.json({ success: true, plans: publicPlans });
};

// GET /api/billing/addons
const getAddons = (req, res) => {
  const plan = req.user?.plan || 'free';
  const availablePacks = Object.entries(ADDON_PACKS)
    .filter(([, pack]) => pack.tiers.includes(plan))
    .map(([key, pack]) => ({ id: key, ...pack }));

  const availableBundles = Object.entries(BUNDLES)
    .filter(([, bundle]) => bundle.tiers.includes(plan))
    .map(([key, bundle]) => ({ id: key, ...bundle }));

  res.json({ success: true, packs: availablePacks, bundles: availableBundles });
};

// GET /api/billing/status
const getBillingStatus = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user.userId;
    if (!userId) return next(new AppError('User not authenticated', 401));

    // Get user plan info
    const result = await pool.query(
      `SELECT plan, plan_expires_at, stripe_customer_id, stripe_subscription_id
       FROM users WHERE id = $1`,
      [userId]
    );
    const user = result.rows[0];
    const plan = user?.plan || 'free';
    const planConfig = PLANS[plan] || PLANS.free;

    // ── Compute live usage from real tables ──────────────────────────
    // 1. Cameras — confirmed devices only
    const camResult = await pool.query(
      `SELECT COUNT(*) FROM devices
       WHERE user_id = $1::uuid
         AND (status IS NULL OR status != 'pending_scan')
         AND deleted_at IS NULL`,
      [userId]
    );
    const cameraCount = parseInt(camResult.rows[0].count, 10);

    // 2. SSIDs — distinct non-null locations (represents distinct networks/sites)
    const ssidResult = await pool.query(
      `SELECT COUNT(DISTINCT location) FROM devices
       WHERE user_id = $1::uuid
         AND location IS NOT NULL AND location != ''
         AND (status IS NULL OR status != 'pending_scan')
         AND deleted_at IS NULL`,
      [userId]
    );
    const ssidCount = parseInt(ssidResult.rows[0].count, 10);

    // 3. Storage — sum file_size bytes from recordings, convert to GB
    const storageResult = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(r.size, r.file_size_bytes, 0)), 0) AS total_bytes
       FROM recordings r
       WHERE r.organization_id = (SELECT organization_id FROM users WHERE id = $1::uuid)`,
      [userId]
    );
    const storageGb = parseFloat(
      (parseFloat(storageResult.rows[0].total_bytes) / (1024 * 1024 * 1024)).toFixed(4)
    );

    // 4. Liberations this month
    const libResult = await pool.query(
      `SELECT COUNT(*) FROM motion_events me
       JOIN devices d ON me.device_id = d.id
       WHERE d.user_id = $1::uuid
         AND me.created_at >= date_trunc('month', NOW())`,
      [userId]
    );
    const liberationsThisMonth = parseInt(libResult.rows[0].count, 10);

    // Write back to users table so overage checker has fresh data
    await pool.query(
      `UPDATE users
       SET cameras_count               = $1,
           ssids_count                 = $2,
           storage_used_gb             = $3,
           liberations_used_this_month = $4,
           updated_at                  = NOW()
       WHERE id = $5::uuid`,
      [cameraCount, ssidCount, storageGb, liberationsThisMonth, userId]
    );

    // Get active add-ons
    const addonsResult = await pool.query(
      `SELECT * FROM user_addons WHERE user_id = $1 AND active = true`,
      [userId]
    );
    const addonTotals = addonsResult.rows.reduce((acc, addon) => {
      acc[addon.addon_type] = (acc[addon.addon_type] || 0) + addon.qty;
      return acc;
    }, {});

    res.json({
      success: true,
      billing: {
        plan,
        plan_name: planConfig.name,
        plan_expires_at: user?.plan_expires_at || null,
        has_payment_method: !!user?.stripe_customer_id,
        limits: {
          cameras:              planConfig.cameras + (addonTotals.camera || 0),
          ssids:                planConfig.ssids + (addonTotals.ssid || 0),
          storage_gb:           planConfig.storage_gb + (addonTotals.storage || 0),
          retention_days:       planConfig.retention_days,
          admins:               planConfig.admins + (addonTotals.admin || 0),
          liberations_per_month: planConfig.liberations_per_month,
          ai_intelligence:      planConfig.ai_intelligence,
          ai_features:          planConfig.ai_features || [],
        },
        usage: {
          cameras:              cameraCount,
          ssids:                ssidCount,
          storage_gb:           storageGb,
          admins:               0,
          liberations_this_month: liberationsThisMonth,
        },
        addons: addonsResult.rows,
      },
    });
  } catch (err) {
    logger.error('Billing status error:', err);
    next(new AppError('Failed to get billing status', 500));
  }
};

// POST /api/billing/subscribe
const createCheckoutSession = async (req, res, next) => {
  try {
    const { plan, coupon } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    if (!plan || !PLANS[plan] || plan === 'free') {
      return next(new AppError('Invalid plan selected', 400));
    }

    const planConfig = PLANS[plan];
    if (!planConfig.stripe_price_id) {
      return next(new AppError('Plan not available for purchase', 400));
    }

    // Get or create Stripe customer
    const userResult = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE id = $1',
      [userId]
    );
    let customerId = userResult.rows[0]?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { user_id: userId.toString() },
      });
      customerId = customer.id;
      await pool.query(
        'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
        [customerId, userId]
      );
    }

    const sessionParams = {
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: planConfig.stripe_price_id, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/?billing=success&plan=${plan}`,
      cancel_url: `${process.env.FRONTEND_URL}/?billing=cancelled`,
      metadata: { user_id: userId.toString(), plan },
      subscription_data: {
        metadata: { user_id: userId.toString(), plan },
      },
      allow_promotion_codes: true,
    };

    // Apply promotion code if provided — look up promo code ID from code string
    if (coupon) {
      try {
        const promoCodes = await stripe.promotionCodes.list({ code: coupon, limit: 1, active: true });
        if (promoCodes.data.length > 0) {
          sessionParams.discounts = [{ promotion_code: promoCodes.data[0].id }];
          delete sessionParams.allow_promotion_codes;
        }
        // If not found, allow_promotion_codes stays true so user can enter at Stripe checkout
      } catch(promoErr) {
        logger.warn('Promo code lookup failed, proceeding without discount:', promoErr.message);
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ success: true, checkout_url: session.url, session_id: session.id });
  } catch (err) {
    logger.error('Stripe checkout error:', { message: err.message, type: err.type, code: err.code, stack: err.stack });
    next(new AppError(`Stripe error: ${err.message}`, 500));
  }
};

// POST /api/billing/addon
const purchaseAddon = async (req, res, next) => {
  try {
    const { addon_id, bundle_id } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    const addon = addon_id ? ADDON_PACKS[addon_id] : null;
    const bundle = bundle_id ? BUNDLES[bundle_id] : null;
    const item = addon || bundle;

    if (!item) return next(new AppError('Invalid add-on selected', 400));

    const userResult = await pool.query(
      'SELECT stripe_customer_id, plan FROM users WHERE id = $1',
      [userId]
    );
    let customerId = userResult.rows[0]?.stripe_customer_id;
    const userPlan = userResult.rows[0]?.plan || 'free';

    // Check tier eligibility
    if (!item.tiers.includes(userPlan)) {
      return next(new AppError(`This add-on requires a higher plan`, 403));
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { user_id: userId.toString() },
      });
      customerId = customer.id;
      await pool.query(
        'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
        [customerId, userId]
      );
    }

    const mode = item.recurring ? 'subscription' : 'payment';
    const priceKey = addon_id
      ? `STRIPE_ADDON_${addon_id.toUpperCase()}_ID`
      : `STRIPE_BUNDLE_${bundle_id.toUpperCase()}_ID`;

    const stripePriceId = process.env[priceKey] || item.stripe_price_id;
    if (!stripePriceId) {
      return next(new AppError('Add-on not yet available for purchase', 400));
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: stripePriceId, quantity: 1 }],
      mode,
      success_url: `${process.env.FRONTEND_URL}/?addon=success&item=${addon_id || bundle_id}`,
      cancel_url: `${process.env.FRONTEND_URL}/?addon=cancelled`,
      metadata: {
        user_id: userId.toString(),
        addon_id: addon_id || '',
        bundle_id: bundle_id || '',
        addon_type: item.type || 'bundle',
        qty: JSON.stringify(item.qty || item.includes || 0),
      },
    });

    res.json({ success: true, checkout_url: session.url });
  } catch (err) {
    logger.error('Addon purchase error:', err);
    next(new AppError('Failed to create add-on checkout', 500));
  }
};

// POST /api/billing/portal
const createPortalSession = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userResult = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE id = $1',
      [userId]
    );
    const customerId = userResult.rows[0]?.stripe_customer_id;
    if (!customerId) return next(new AppError('No billing account found', 404));

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.FRONTEND_URL}/dashboard`,
    });

    res.json({ success: true, portal_url: session.url });
  } catch (err) {
    logger.error('Stripe portal error:', err);
    next(new AppError('Failed to create billing portal session', 500));
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// OVERAGE CHECKER — called by cron job
// ─────────────────────────────────────────────────────────────────────────────
const checkOverages = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.plan, u.email, u.stripe_customer_id, u.stripe_subscription_id,
              u.storage_used_gb, u.cameras_count, u.ssids_count, u.admins_count,
              u.clips_per_day_avg, u.storage_growth_gb_per_day,
              u.overage_grace_expires_at, u.overage_notified_at
       FROM users u WHERE u.id = $1`,
      [userId]
    );

    const user = result.rows[0];
    if (!user) return;

    const plan = PLANS[user.plan] || PLANS.free;
    const now = new Date();
    const overages = [];

    // Get add-on totals
    const addonsResult = await pool.query(
      `SELECT addon_type, SUM(qty) as total_qty
       FROM user_addons WHERE user_id = $1 AND active = true
       GROUP BY addon_type`,
      [userId]
    );
    const addonTotals = addonsResult.rows.reduce((acc, row) => {
      acc[row.addon_type] = parseInt(row.total_qty);
      return acc;
    }, {});

    const effectiveLimits = {
      cameras: plan.cameras + (addonTotals.camera || 0),
      ssids: plan.ssids + (addonTotals.ssid || 0),
      storage_gb: plan.storage_gb + (addonTotals.storage || 0),
      admins: plan.admins + (addonTotals.admin || 0),
    };

    // Check camera overage
    if (user.cameras_count > effectiveLimits.cameras && plan.overage_camera_price) {
      const excess = user.cameras_count - effectiveLimits.cameras;
      overages.push({
        type: 'camera',
        excess,
        monthly_charge: excess * plan.overage_camera_price,
      });
    }

    // Check SSID overage
    if (user.ssids_count > effectiveLimits.ssids) {
      const excess = user.ssids_count - effectiveLimits.ssids;
      overages.push({
        type: 'ssid',
        excess,
        monthly_charge: excess * plan.overage_ssid_price,
      });
    }

    // Check storage overage
    if (user.storage_used_gb > effectiveLimits.storage_gb) {
      const excessGb = user.storage_used_gb - effectiveLimits.storage_gb;
      const chunkedGb = roundUpToChunk(excessGb);
      overages.push({
        type: 'storage',
        excess_gb: excessGb,
        billed_gb: chunkedGb,
        monthly_charge: chunkedGb * plan.overage_storage_price,
      });
    }

    if (overages.length === 0) return;

    // Calculate grace period
    const graceHours = getGracePeriodHours(
      user.clips_per_day_avg || 0,
      user.storage_growth_gb_per_day || 0
    );

    // First detection — set grace period
    if (!user.overage_grace_expires_at) {
      const graceExpires = new Date(now.getTime() + graceHours * 60 * 60 * 1000);
      await pool.query(
        `UPDATE users SET overage_grace_expires_at = $1, overage_notified_at = NOW()
         WHERE id = $2`,
        [graceExpires, userId]
      );
      logger.info('Overage grace period started', { userId, graceHours, overages });
      return { status: 'grace_started', graceHours, overages };
    }

    // Grace period still active
    if (new Date(user.overage_grace_expires_at) > now) {
      logger.info('User in overage grace period', { userId });
      return { status: 'in_grace', overages };
    }

    // Grace expired — apply charges on next invoice via Stripe
    if (user.stripe_subscription_id && user.stripe_customer_id) {
      for (const overage of overages) {
        if (overage.monthly_charge > 0) {
          await stripe.invoiceItems.create({
            customer: user.stripe_customer_id,
            amount: overage.monthly_charge,
            currency: 'usd',
            description: `Overage charge: ${overage.type} (${overage.excess || overage.billed_gb} ${overage.type === 'storage' ? 'GB' : 'units'})`,
            subscription: user.stripe_subscription_id,
          });
        }
      }

      // Reset grace period
      await pool.query(
        `UPDATE users SET overage_grace_expires_at = NULL, overage_notified_at = NULL
         WHERE id = $1`,
        [userId]
      );

      logger.info('Overage charges applied', { userId, overages });
      return { status: 'charged', overages };
    }
  } catch (err) {
    logger.error('Overage check error:', { userId, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 60-DAY ADD-ON OPTIMIZATION
// ─────────────────────────────────────────────────────────────────────────────
const runAddonOptimization = async (userId) => {
  try {
    const addonsResult = await pool.query(
      `SELECT a.*, p.stripe_price_id as new_price_id
       FROM user_addons a
       LEFT JOIN addon_price_map p ON p.addon_id = a.addon_id
       WHERE a.user_id = $1
         AND a.active = true
         AND a.recurring = true
         AND a.purchased_at < NOW() - INTERVAL '${OPTIMIZATION_DAYS} days'
         AND a.optimization_notified_at IS NULL`,
      [userId]
    );

    for (const addon of addonsResult.rows) {
      const usageRatio = addon.avg_used_qty / addon.purchased_qty;

      if (usageRatio < OPTIMIZATION_THRESHOLD) {
        // Find the best matching smaller pack
        const optimalQty = Math.ceil(addon.avg_used_qty);
        const packKey = `${addon.addon_type}_${optimalQty}`;
        const optimalPack = ADDON_PACKS[packKey];

        if (optimalPack && optimalPack.price < addon.price) {
          const savings = addon.price - optimalPack.price;

          // Mark for optimization — apply at next billing cycle
          await pool.query(
            `UPDATE user_addons
             SET optimization_notified_at = NOW(),
                 optimization_pending_pack = $1,
                 optimization_savings = $2,
                 optimization_apply_at = NOW() + INTERVAL '${OPTIMIZATION_NOTICE_DAYS} days'
             WHERE id = $3`,
            [packKey, savings, addon.id]
          );

          logger.info('Add-on optimization scheduled', {
            userId,
            addonId: addon.id,
            from: addon.addon_id,
            to: packKey,
            savings,
          });
        }
      }
    }

    // Apply any pending optimizations that have passed notice period
    const pendingResult = await pool.query(
      `SELECT * FROM user_addons
       WHERE user_id = $1
         AND optimization_pending_pack IS NOT NULL
         AND optimization_apply_at < NOW()
         AND optimization_applied_at IS NULL`,
      [userId]
    );

    for (const pending of pendingResult.rows) {
      const newPack = ADDON_PACKS[pending.optimization_pending_pack];
      if (newPack) {
        // Update Stripe subscription item to new price
        // (handled by billing portal or webhook)
        await pool.query(
          `UPDATE user_addons
           SET addon_id = $1,
               qty = $2,
               price = $3,
               optimization_applied_at = NOW(),
               optimization_pending_pack = NULL
           WHERE id = $4`,
          [pending.optimization_pending_pack, newPack.qty, newPack.price, pending.id]
        );

        logger.info('Add-on optimization applied — lower charge next cycle', {
          userId,
          savings: pending.optimization_savings,
        });
      }
    }
  } catch (err) {
    logger.error('Addon optimization error:', { userId, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE WEBHOOK
// ─────────────────────────────────────────────────────────────────────────────
const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error('Stripe webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        const plan = session.metadata?.plan;
        const addonId = session.metadata?.addon_id;
        const bundleId = session.metadata?.bundle_id;
        const subscriptionId = session.subscription;

        // Plan upgrade
        if (userId && plan && !addonId && !bundleId) {
          await pool.query(
            `UPDATE users
             SET plan = $1,
                 stripe_subscription_id = $2,
                 plan_expires_at = NOW() + INTERVAL '1 month'
             WHERE id = $3`,
            [plan, subscriptionId, userId]
          );
          logger.info(`User ${userId} upgraded to ${plan}`);
        }

        // Add-on or bundle purchased
        if (userId && (addonId || bundleId)) {
          const item = addonId ? ADDON_PACKS[addonId] : BUNDLES[bundleId];
          if (item) {
            const qty = item.qty || item.includes;
            const addonType = item.type || 'bundle';

            if (addonType === 'bundle' && item.includes) {
              // Insert multiple addon rows for bundle
              for (const [type, amount] of Object.entries(item.includes)) {
                await pool.query(
                  `INSERT INTO user_addons
                   (user_id, addon_id, addon_type, qty, price, purchased_qty,
                    avg_used_qty, recurring, active, purchased_at)
                   VALUES ($1, $2, $3, $4, $5, $4, 0, $6, true, NOW())`,
                  [userId, `${bundleId}_${type}`, type.replace('_gb','').replace('cameras','camera').replace('ssids','ssid'), amount, item.price / 3, item.recurring]
                );
              }
            } else {
              await pool.query(
                `INSERT INTO user_addons
                 (user_id, addon_id, addon_type, qty, price, purchased_qty,
                  avg_used_qty, recurring, active, purchased_at)
                 VALUES ($1, $2, $3, $4, $5, $4, 0, $6, true, NOW())`,
                [userId, addonId, addonType, qty, item.price, item.recurring]
              );
            }

            logger.info(`Add-on ${addonId || bundleId} activated for user ${userId}`);
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = sub.metadata?.user_id;
        const plan = sub.metadata?.plan;

        if (userId && plan && sub.status === 'active') {
          const expiresAt = new Date(sub.current_period_end * 1000);
          await pool.query(
            `UPDATE users SET plan = $1, plan_expires_at = $2 WHERE id = $3`,
            [plan, expiresAt, userId]
          );
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.user_id;

        if (userId) {
          await pool.query(
            `UPDATE users
             SET plan = 'free',
                 stripe_subscription_id = NULL,
                 plan_expires_at = NULL
             WHERE id = $1`,
            [userId]
          );

          // Deactivate recurring add-ons
          await pool.query(
            `UPDATE user_addons SET active = false
             WHERE user_id = $1 AND recurring = true`,
            [userId]
          );

          logger.info(`User ${userId} cancelled — downgraded to free`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const result = await pool.query(
          'SELECT id FROM users WHERE stripe_customer_id = $1',
          [customerId]
        );
        if (result.rows[0]) {
          logger.warn(`Payment failed for user ${result.rows[0].id}`);
          // TODO: trigger payment failure email
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const result = await pool.query(
          'SELECT id FROM users WHERE stripe_customer_id = $1',
          [customerId]
        );
        if (result.rows[0]) {
          // Reset any overage grace periods on successful payment
          await pool.query(
            `UPDATE users SET overage_grace_expires_at = NULL, overage_notified_at = NULL
             WHERE id = $1`,
            [result.rows[0].id]
          );

          // Run optimization check
          await runAddonOptimization(result.rows[0].id);
        }
        break;
      }

      default:
        logger.info(`Unhandled Stripe event: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    logger.error('Webhook handler error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = {
  getPlans,
  getAddons,
  createCheckoutSession,
  createPortalSession,
  purchaseAddon,
  getBillingStatus,
  handleWebhook,
  checkOverages,
  runAddonOptimization,
  PLANS,
  ADDON_PACKS,
  BUNDLES,
  getGracePeriodHours,
  roundUpToChunk,
};
