const Device = require('../models/Device');
const config = require('../config');

exports.getStreamConfig = async (req, res, next) => {
  try {
    const device = await Device.findById(req.params.deviceId, req.user.id);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });

    res.json({
      success: true,
      data: {
        iceServers: [
          { urls: config.WEBRTC.stunServer },
          { urls: config.WEBRTC.turnServer, username: config.WEBRTC.turnUsername, credential: config.WEBRTC.turnPassword },
        ],
        streamKey: device.stream_key,
      }
    });
  } catch (err) { next(err); }
};

exports.startStream = async (req, res, next) => {
  try {
    const device = await Device.findById(req.params.deviceId, req.user.id);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    await Device.updateLastSeen(device.id);
    res.json({ success: true, message: 'Stream started', data: { deviceId: device.id } });
  } catch (err) { next(err); }
};

exports.stopStream = async (req, res, next) => {
  try {
    const device = await Device.findById(req.params.deviceId, req.user.id);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, message: 'Stream stopped' });
  } catch (err) { next(err); }
};