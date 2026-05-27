const express = require('express');
const router = express.Router();
const streamController = require('../controllers/streamController');

router.get('/:deviceId/config', streamController.getStreamConfig);
router.post('/:deviceId/start', streamController.startStream);
router.post('/:deviceId/stop', streamController.stopStream);

module.exports = router;