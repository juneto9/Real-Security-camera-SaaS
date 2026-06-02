const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  getPlans,
  createCheckoutSession,
  createPortalSession,
  getBillingStatus,
  handleWebhook,
} = require('../controllers/billingController');

// Stripe webhook MUST receive raw body — mount BEFORE express.json()
// This route is registered in server.js before body parsers
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  handleWebhook
);

// All other billing routes require auth
router.get('/plans', getPlans);
router.get('/status', authenticate, getBillingStatus);
router.post('/subscribe', authenticate, createCheckoutSession);
router.post('/portal', authenticate, createPortalSession);

module.exports = router;
