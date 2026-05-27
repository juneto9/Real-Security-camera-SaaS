// backend/routes/deviceRoutes.js
const express = require('express');
const router = express.Router();
const DeviceController = require('../controllers/DeviceController');
const { authenticate } = require('../middleware/auth');
const { validateDevice } = require('../validators');

router.use(authenticate); // All device routes require authentication

router.post('/', validateDevice, DeviceController.registerDevice);
router.get('/', DeviceController.getOrganizationDevices);
router.get('/active', DeviceController.getActiveDevices);
router.get('/:deviceId', DeviceController.getDevice);
router.put('/:deviceId', validateDevice, DeviceController.updateDevice);
router.delete('/:deviceId', DeviceController.deleteDevice);
router.post('/:deviceId/test-connection', DeviceController.testConnection);

module.exports = router;