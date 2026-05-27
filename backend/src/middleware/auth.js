const jwt = require('../utils/jwt');
const logger = require('../utils/logger');
const db = require('../utils/database');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ success: false, message: 'Missing authorization header' });
    }

    const token = jwt.extractTokenFromHeader(authHeader);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Invalid authorization format' });
    }

    const decoded = jwt.verifyToken(token);
    if (!decoded.userId) {
      return res.status(401).json({ success: false, message: 'Invalid token payload' });
    }

    const result = await db.query(
      `SELECT u.id, u.email, u.role, u.is_active, u.organization_id,
              o.name as org_name, o.slug as org_slug, o.max_devices, o.max_users
       FROM users u
       JOIN organizations o ON u.organization_id = o.id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(401).json({ success: false, message: 'Account inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.message === 'Token has expired') {
      return res.status(401).json({ success: false, message: 'Token has expired' });
    }
    if (error.message === 'Invalid token') {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    logger.error('Auth middleware error', { error: error.message });
    res.status(500).json({ success: false, message: 'Authentication error' });
  }
};

module.exports = authMiddleware;
