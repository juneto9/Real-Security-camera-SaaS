const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../utils/database');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    cameras: 2,
    retention_days: 14,
    ai_intelligence: false,
    camera_liberation: 0,
    admins: 1,
  },
  pro: {
    name: 'Pro',
    price: 1499,
    cameras: 5,
    retention_days: 60,
    ai_intelligence: true,
    camera_liberation: 3,
    admins: 2,
    stripe_price_id: process.env.STRIPE_PRO_PRICE_ID,
  },
  business: {
    name: 'Business',
    price: 3999,
    cameras: 20,
    retention_days: 180,
    ai_intelligence: true,
    camera_liberation: -1, // unlimited
    admins: 3,
    stripe_price_id: process.env.STRIPE_BUSINESS_PRICE_ID,
  },
  enterprise: {
    name: 'Enterprise',
    price: 9999,
    cameras: -1, // unlimited
    retention_days: 365,
    ai_intelligence: true,
    camera_liberation: -1,
    admins: -1,
    stripe_price_id: process.env.STRIPE_ENTERPRISE_PRICE_ID,
  },
};

// GET /api/billing/plans
const getPlans = (req, res) => {
  const publicPlans = Object.entries(PLANS).map(([key, plan]) => ({
    id: key,
    name: plan.name,
    price: plan.price,
    cameras: plan.cameras,
    retention_days: plan.retention_days,
    ai_intelligence: plan.ai_intelligence,
    camera_liberation: plan.camera_liberation,
    admins: plan.admins,
  }));
  res.json({ success: true, plans: publicPlans });
};

// POST /api/billing/subscribe
const createCheckoutSession = async (req, res, next) => {
  try {
    const { plan } = req.body;
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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: planConfig.stripe_price_id, quantity: 1 }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/dashboard?billing=success&plan=${plan}`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard?billing=cancelled`,
      metadata: { user_id: userId.toString(), plan },
      subscription_data: {
        metadata: { user_id: userId.toString(), plan },
      },
    });

    res.json({ success: true, checkout_url: session.url, session_id: session.id });
  } catch (err) {
    logger.error('Stripe checkout error:', err);
    next(new AppError('Failed to create checkout session', 500));
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

    if (!customerId) {
      return next(new AppError('No billing account found', 404));
    }

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

// GET /api/billing/status
const getBillingStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT plan, plan_expires_at, stripe_customer_id, stripe_subscription_id FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];
    const plan = user?.plan || 'free';
    const planConfig = PLANS[plan] || PLANS.free;

    res.json({
      success: true,
      billing: {
        plan,
        plan_name: planConfig.name,
        plan_expires_at: user?.plan_expires_at || null,
        limits: {
          cameras: planConfig.cameras,
          retention_days: planConfig.retention_days,
          ai_intelligence: planConfig.ai_intelligence,
          camera_liberation: planConfig.camera_liberation,
          admins: planConfig.admins,
        },
        has_payment_method: !!user?.stripe_customer_id,
      },
    });
  } catch (err) {
    logger.error('Billing status error:', err);
    next(new AppError('Failed to get billing status', 500));
  }
};

// POST /api/billing/webhook  (raw body required — see billing route)
const handleWebhook = async (req, res, next) => {
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
        const subscriptionId = session.subscription;

        if (userId && plan) {
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
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = sub.metadata?.user_id;
        const plan = sub.metadata?.plan;

        if (userId && plan && sub.status === 'active') {
          const expiresAt = new Date(sub.current_period_end * 1000);
          await pool.query(
            `UPDATE users
             SET plan = $1,
                 plan_expires_at = $2
             WHERE id = $3`,
            [plan, expiresAt, userId]
          );
          logger.info(`User ${userId} subscription updated to ${plan}`);
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
          logger.info(`User ${userId} subscription cancelled — downgraded to free`);
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
          // TODO: send payment failure email via notification service
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
  createCheckoutSession,
  createPortalSession,
  getBillingStatus,
  handleWebhook,
  PLANS,
};
