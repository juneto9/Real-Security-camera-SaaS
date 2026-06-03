const express = require('express');
const router = express.Router();
const usageController = require('../controllers/usageController');

// GET /api/usage — live subscription usage counters
router.get('/', usageController.getUsage);

module.exports = router;
