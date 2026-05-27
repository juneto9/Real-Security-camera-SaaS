// backend/routes/motionEventRoutes.js
const express = require('express');
const router = express.Router();
const MotionEventController = require('../controllers/MotionEventController');
const { authenticate } = require('../middleware/auth');
const { validateMotionEvent } = require('../validators');

router.use(authenticate); // All motion event routes require authentication

router.post('/', validateMotionEvent, MotionEventController.createMotionEvent);
router.get('/device/:deviceId', MotionEventController.getDeviceMotionEvents);
router.get('/device/:deviceId/date-range', MotionEventController.getMotionEventsByDateRange);
router.get('/device/:deviceId/stats', MotionEventController.getMotionStats);

module.exports = router;