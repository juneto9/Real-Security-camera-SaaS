const Device = require('../models/Device');
const logger = require('../utils/logger');

exports.getDevices = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const result = await Device.getByUserId(req.user.userId, parseInt(limit), (page - 1) * limit);
    res.json({ success: true, data: result.data, total: result.total, page, limit });
  } catch (err) { 
    logger.error('Error getting devices', { error: err.message });
    next(err); 
  }
};

exports.getDevice = async (req, res, next) => {
  try {
    const device = await Device.findById(req.params.deviceId, req.user.userId);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) { 
    logger.error('Error getting device', { error: err.message });
    next(err); 
  }
};

exports.createDevice = async (req, res, next) => {
  try {
    const { name, location, rtsp_url } = req.body;
    
    if (!name || !location) {
      return res.status(400).json({ success: false, message: 'Name and location are required' });
    }
    
    const device = await Device.create(
      req.user.userId,
      req.user.organization_id,
      name,
      location,
      rtsp_url || ''
    );
    
    res.status(201).json({ success: true, data: device });
  } catch (err) { 
    logger.error('Error creating device', { error: err.message });
    next(err); 
  }
};

exports.updateDevice = async (req, res, next) => {
  try {
    const device = await Device.update(req.params.deviceId, req.user.userId, req.body);
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) { 
    logger.error('Error updating device', { error: err.message });
    next(err); 
  }
};

exports.deleteDevice = async (req, res, next) => {
  try {
    const deleted = await Device.softDelete(req.params.deviceId, req.user.userId);
    if (!deleted) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, message: 'Device deleted' });
  } catch (err) { 
    logger.error('Error deleting device', { error: err.message });
    next(err); 
  }
};