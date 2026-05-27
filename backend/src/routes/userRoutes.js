// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const UserController = require('../controllers/UserController');
const { authenticate } = require('../middleware/auth');
const { validateRegister, validateLogin } = require('../validators');

// Public routes
router.post('/register', validateRegister, UserController.register);
router.post('/login', validateLogin, UserController.login);

// Protected routes
router.get('/profile', authenticate, UserController.getProfile);
router.put('/profile', authenticate, UserController.updateProfile);
router.post('/change-password', authenticate, UserController.changePassword);
router.delete('/account', authenticate, UserController.deleteAccount);
router.get('/organization/users', authenticate, UserController.getOrganizationUsers);

module.exports = router;