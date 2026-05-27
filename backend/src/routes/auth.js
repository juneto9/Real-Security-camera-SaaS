const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { handleValidationErrors } = require('../utils/validators');

router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('first_name').trim().notEmpty(),
  body('last_name').trim().notEmpty(),
  handleValidationErrors,
], authController.register);

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  handleValidationErrors,
], authController.login);

router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

module.exports = router;