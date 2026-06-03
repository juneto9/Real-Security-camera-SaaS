const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const userController = require('../controllers/userController');
const { handleValidationErrors } = require('../utils/validators');
const { updateUsage } = require('../controllers/usagePatch');

router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);
router.put('/me/password', userController.changePassword);
router.patch('/usage', authenticate, updateUsage);

module.exports = router;
