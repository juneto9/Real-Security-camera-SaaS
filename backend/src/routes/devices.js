const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');

router.get('/', deviceController.getDevices);
router.post('/', deviceController.createDevice);
router.get('/:deviceId', deviceController.getDevice);
router.put('/:deviceId', deviceController.updateDevice);
router.delete('/:deviceId', deviceController.deleteDevice);

module.exports = router;