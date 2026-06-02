const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const {
  getPlans,
  getAddons,
  createCheckoutSession,
  createPortalSession,
  purchaseAddon,
  getBillingStatus,
  handleWebhook,
} = require('../controllers/billingController');

// Stripe webhook — raw body required for signature verification
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// All other routes need JSON body — apply parser explicitly here
router.use(express.json());

// Public
router.get('/plans', getPlans);

// Authenticated
router.get('/status',     authenticate, getBillingStatus);
router.get('/addons',     authenticate, getAddons);
router.post('/subscribe', authenticate, createCheckoutSession);
router.post('/portal',    authenticate, createPortalSession);
router.post('/addon',     authenticate, purchaseAddon);

module.exports = router;
