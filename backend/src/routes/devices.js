const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const authMiddleware = require('../middleware/auth');

// All routes require authentication
// IMPORTANT: Static routes (/discover) MUST be declared before dynamic routes (/:deviceId)
// or Express will match "discover" as a deviceId param and crash with a UUID error.

router.get('/', authMiddleware, deviceController.getDevices);
router.post('/', authMiddleware, deviceController.createDevice);

// Static route — must come before /:deviceId
router.get('/discover', authMiddleware, deviceController.discoverDevices);

// Dynamic routes
router.get('/:deviceId', authMiddleware, deviceController.getDevice);
router.put('/:deviceId', authMiddleware, deviceController.updateDevice);
router.delete('/:deviceId', authMiddleware, deviceController.deleteDevice);

module.exports = router;
