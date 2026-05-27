// backend/routes/recordingRoutes.js
const express = require('express');
const router = express.Router();
const RecordingController = require('../controllers/RecordingController');
const { authenticate } = require('../middleware/auth');
const { validateRecording } = require('../validators');

router.use(authenticate); // All recording routes require authentication

router.post('/', validateRecording, RecordingController.createRecording);
router.get('/', RecordingController.getOrganizationRecordings);
router.get('/stats', RecordingController.getRecordingStats);
router.get('/:recordingId', RecordingController.getRecording);
router.get('/:recordingId/url', RecordingController.getRecordingUrl);
router.delete('/:recordingId', RecordingController.deleteRecording);
router.post('/cleanup', RecordingController.cleanupOldRecordings);

// Device-specific recording routes
router.get('/device/:deviceId', RecordingController.getDeviceRecordings);
router.get('/device/:deviceId/date-range', RecordingController.getRecordingsByDateRange);
router.get('/device/:deviceId/type', RecordingController.getRecordingsByType);

module.exports = router;