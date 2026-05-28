const jwt = require('../utils/jwt');
const logger = require('../utils/logger');
const db = require('../utils/database');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Missing authorization header',
      });
    }

    const token = jwt.extractTokenFromHeader(authHeader);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization format',
      });
    }

    const decoded = jwt.verifyToken(token);

    // Normalize: accept both camelCase (userId) and snake_case (user_id) token payloads
    const resolvedUserId = decoded.userId || decoded.user_id;
    if (!resolvedUserId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload',
      });
    }

    // Verify user still exists
    const result = await db.query(
      'SELECT id, email, is_active FROM users WHERE id = $1',
      [resolvedUserId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'User account is inactive',
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
    };

    next();
  } catch (error) {
    if (error.message === 'Token has expired') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired',
      });
    }
    if (error.message === 'Invalid token') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    logger.error('Auth middleware error', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Authentication error',
    });
  }
};

module.exports = authMiddleware;