const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { handleValidationErrors } = require('../utils/validators');

router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);
router.put('/me/password', userController.changePassword);

module.exports = router;