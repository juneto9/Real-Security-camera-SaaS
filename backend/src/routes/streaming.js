// streaming.js — WebRTC signaling routes
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// Get active streams for an organization
router.get('/streams', auth, async (req, res) => {
  try {
    const io = req.app.get('io');
    const activeStreams = req.app.get('activeStreams') || {};
    const orgStreams = Object.values(activeStreams).filter(
      s => s.organizationId === req.user.organizationId
    );
    res.json({ success: true, data: orgStreams });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Register a device as a stream source
router.post('/streams/register', auth, (req, res) => {
  const { deviceId, deviceName, streamType } = req.body;
  if (!deviceId) return res.status(400).json({ success: false, message: 'deviceId required' });
  const activeStreams = req.app.get('activeStreams') || {};
  activeStreams[deviceId] = {
    deviceId, deviceName, streamType: streamType || 'camera',
    organizationId: req.user.organizationId,
    userId: req.user.userId,
    registeredAt: new Date().toISOString(),
    online: false,
  };
  req.app.set('activeStreams', activeStreams);
  res.json({ success: true, data: activeStreams[deviceId] });
});

module.exports = router;
