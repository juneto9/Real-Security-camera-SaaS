const express = require('express');
const router = express.Router();
const motionEventService = require('../services/MotionEventService');
const Device = require('../models/Device');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/database');
const logger = require('../utils/logger');

const RECORDING_DURATION_MS = parseInt(process.env.MOTION_TRIGGER_DURATION || '30') * 1000;

// Mobile app calls this when motion is detected
router.post('/detect', async (req, res, next) => {
  try {
    const { device_id, confidence = 80, stream_key, s3_snapshot_url } = req.body;

    // Find device by stream_key (no auth needed for device) or device_id + user auth
    let device;
    if (stream_key) {
      device = await Device.findByStreamKey(stream_key);
    } else {
      device = await Device.findById(device_id, req.user.id);
    }
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    // Start 30-second recording
    const recordingId = uuidv4();
    await db.query(
      `INSERT INTO recordings (id, device_id, start_time, motion_detected, created_at, expires_at)
       VALUES ($1, $2, NOW(), true, NOW(), NOW() + INTERVAL '11 days')`,
      [recordingId, device.id]
    );

    // Create motion event linked to recording
    const result = await motionEventService.createMotionEvent({
      device_id: device.id,
      confidence,
      s3_snapshot_url,
      recording_id: recordingId,
    }, device.user_id);

    // Close recording after 30 seconds
    setTimeout(async () => {
      try {
        await db.query(
          `UPDATE recordings SET end_time = NOW(), duration = $1 WHERE id = $2`,
          [RECORDING_DURATION_MS / 1000, recordingId]
        );
        logger.info('30s motion recording completed', { recordingId, deviceId: device.id });
      } catch (err) {
        logger.error('Error closing recording', { error: err.message });
      }
    }, RECORDING_DURATION_MS);

    res.json({ success: true, data: { ...result, recordingId } });
  } catch (err) { next(err); }
});

// Get motion events for a device
router.get('/:deviceId', async (req, res, next) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const events = await motionEventService.getDeviceMotionEvents(
      req.params.deviceId, parseInt(limit), parseInt(offset)
    );
    res.json({ success: true, data: events });
  } catch (err) { next(err); }
});

// Get motion stats for a device
router.get('/:deviceId/stats', async (req, res, next) => {
  try {
    const { days = 7 } = req.query;
    const stats = await motionEventService.getMotionStats(req.params.deviceId, parseInt(days));
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
});

// Get motion events by date range
router.get('/:deviceId/range', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'startDate and endDate required' });
    }
    const events = await motionEventService.getMotionEventsByDateRange(
      req.params.deviceId, startDate, endDate
    );
    res.json({ success: true, data: events });
  } catch (err) { next(err); }
});

module.exports = router;
