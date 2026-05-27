const Device = require('../models/Device');

exports.getDevices = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const result = await Device.getByUserId(req.user.id, parseInt(limit), parseInt(offset));
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

exports.getDevice = async (req, res, next) => {
  try {
    const device = await Device.findById(req.params.deviceId, req.user.id);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) { next(err); }
};

exports.createDevice = async (req, res, next) => {
  try {
    const { device_name, location, device_type } = req.body;
    const device = await Device.create(req.user.id, device_name, location, device_type);
    res.status(201).json({ success: true, data: device });
  } catch (err) { next(err); }
};

exports.updateDevice = async (req, res, next) => {
  try {
    const device = await Device.update(req.params.deviceId, req.user.id, req.body);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) { next(err); }
};

exports.deleteDevice = async (req, res, next) => {
  try {
    const deleted = await Device.delete(req.params.deviceId, req.user.id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, message: 'Device deleted' });
  } catch (err) { next(err); }
};