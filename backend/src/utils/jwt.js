const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('./logger');

// Generate JWT token
const generateToken = (payload, expiresIn = config.JWT.expiresIn) => {
  try {
    const token = jwt.sign(payload, config.JWT.secret, {
      expiresIn,
      algorithm: 'HS256',
    });
    return token;
  } catch (error) {
    logger.error('Error generating JWT token', { error: error.message });
    throw error;
  }
};

// Generate access and refresh token pair
const generateTokenPair = (userId, email) => {
  const payload = {
    userId,
    email,
    type: 'access',
  };

  const accessToken = generateToken(payload, config.JWT.expiresIn);
  const refreshToken = generateToken(
    { ...payload, type: 'refresh' },
    config.JWT.refreshExpiresIn
  );

  return { accessToken, refreshToken };
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.JWT.secret, {
      algorithms: ['HS256'],
    });
    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.warn('Token expired', { expiredAt: error.expiredAt });
      throw new Error('Token has expired');
    }
    if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid token', { error: error.message });
      throw new Error('Invalid token');
    }
    throw error;
  }
};

// Decode token without verification (for inspection)
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    logger.error('Error decoding token', { error: error.message });
    return null;
  }
};

// Extract token from Authorization header
const extractTokenFromHeader = (authHeader) => {
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
};

// Validate token and extract payload
const validateAndExtractToken = (token) => {
  try {
    const decoded = verifyToken(token);
    return { valid: true, payload: decoded };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

module.exports = {
  generateToken,
  generateTokenPair,
  verifyToken,
  decodeToken,
  extractTokenFromHeader,
  validateAndExtractToken,
};