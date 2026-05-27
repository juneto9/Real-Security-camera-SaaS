const { body, param, query, validationResult } = require('express-validator');

// Email validation
const validateEmail = () => {
  return body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email address');
};

// Password validation (min 8 chars, 1 uppercase, 1 number)
const validatePassword = () => {
  return body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
    .withMessage('Password must contain uppercase, number, and special character');
};

// Device name validation
const validateDeviceName = () => {
  return body('device_name')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Device name must be between 1 and 255 characters');
};

// Device ID validation
const validateDeviceId = () => {
  return param('deviceId')
    .isUUID()
    .withMessage('Invalid device ID');
};

// Recording ID validation
const validateRecordingId = () => {
  return param('recordingId')
    .isUUID()
    .withMessage('Invalid recording ID');
};

// Motion sensitivity validation (1-100)
const validateMotionSensitivity = () => {
  return body('motion_sensitivity')
    .isInt({ min: 1, max: 100 })
    .withMessage('Motion sensitivity must be between 1 and 100');
};

// Frame rate validation (1-60)
const validateFrameRate = () => {
  return body('frame_rate')
    .isInt({ min: 1, max: 60 })
    .withMessage('Frame rate must be between 1 and 60');
};

// Resolution validation
const validateResolution = () => {
  return body('resolution')
    .isIn(['720p', '1080p', '2k', '4k'])
    .withMessage('Invalid resolution');
};

// Pagination validation
const validatePagination = () => {
  return [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
  ];
};

// Date range validation
const validateDateRange = () => {
  return [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid start date'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('Invalid end date'),
  ];
};

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map((err) => ({
        field: err.param,
        message: err.msg,
      })),
    });
  }
  next();
};

module.exports = {
  validateEmail,
  validatePassword,
  validateDeviceName,
  validateDeviceId,
  validateRecordingId,
  validateMotionSensitivity,
  validateFrameRate,
  validateResolution,
  validatePagination,
  validateDateRange,
  handleValidationErrors,
};