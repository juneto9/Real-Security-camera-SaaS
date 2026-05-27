const express = require('express');
const router = express.Router();
const recordingController = require('../controllers/recordingController');

router.get('/', recordingController.getRecordings);
router.get('/:recordingId', recordingController.getRecording);
router.delete('/:recordingId', recordingController.deleteRecording);

module.exports = router;
