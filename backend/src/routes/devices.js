const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const authMiddleware = require('../middleware/auth');

router.get('/', authMiddleware, deviceController.getDevices);
router.post('/', authMiddleware, deviceController.createDevice);
router.get('/:deviceId', authMiddleware, deviceController.getDevice);
router.put('/:deviceId', authMiddleware, deviceController.updateDevice);
router.patch('/:deviceId/confirm', authMiddleware, deviceController.confirmDevice); // QR scan confirm
router.delete('/:deviceId', authMiddleware, deviceController.deleteDevice);

module.exports = router;
