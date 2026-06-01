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

    // Fetch full user including organization_id
    const result = await db.query(
      `SELECT id, email, organization_id, role, is_active
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(401).json({ success: false, message: 'User account is inactive' });
    }

    // Attach full user context — use consistent field names across all controllers
    req.user = {
      id:              user.id,
      userId:          user.id,           // alias used by most controllers
      email:           user.email,
      organization_id: user.organization_id,
      organizationId:  user.organization_id, // alias used by signaling server
      org_id:          user.organization_id, // alias used by some endpoints
      role:            user.role,
    };

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
