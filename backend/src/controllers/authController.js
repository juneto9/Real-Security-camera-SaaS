const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../utils/database');
const jwt = require('../utils/jwt');
const logger = require('../utils/logger');
const config = require('../config');

exports.register = async (req, res, next) => {
  try {
    const { email, password, first_name, last_name, org_name, phone } = req.body;

    // Check if email already exists
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    // Create slug from org name or email
    const orgName = org_name || `${first_name} ${last_name}`;
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();

    // Create organization first
    const orgResult = await db.query(
      `INSERT INTO organizations (name, slug, max_devices, max_users, storage_limit_gb, is_active, created_at, updated_at)
       VALUES ($1, $2, 20, 4, 100, true, NOW(), NOW())
       RETURNING id, name, slug`,
      [orgName, slug]
    );
    const org = orgResult.rows[0];

    // Hash password
    const password_hash = await bcrypt.hash(password, config.SECURITY.bcryptRounds);

    // Create user linked to organization as admin
    const userResult = await db.query(
      `INSERT INTO users (organization_id, email, password_hash, first_name, last_name, phone, role, is_active, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'admin', true, false, NOW(), NOW())
       RETURNING id, organization_id, email, first_name, last_name, role, is_active, created_at`,
      [org.id, email.toLowerCase(), password_hash, first_name, last_name, phone || null]
    );
    const user = userResult.rows[0];

    // ✅ PASS organizationId to generateTokenPair
    const { accessToken, refreshToken } = jwt.generateTokenPair(
      user.id, 
      user.email,
      user.organization_id  // ← ADD THIS
    );

    logger.info('User registered', { userId: user.id, orgId: org.id, email: user.email });

    res.status(201).json({
      success: true,
      data: { user, organization: org, accessToken, refreshToken }
    });
  } catch (err) {
    logger.error('Register error', { error: err.message });
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await db.query(
      `SELECT u.*, o.name as org_name, o.slug as org_slug, o.id as org_id
       FROM users u
       JOIN organizations o ON u.organization_id = o.id
       WHERE u.email = $1 AND u.deleted_at IS NULL`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ success: false, message: 'Account inactive' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Update last login
    await db.query(
      'UPDATE users SET last_login_at = NOW(), last_login_ip = $1 WHERE id = $2',
      [req.ip, user.id]
    );

    // ✅ PASS organizationId to generateTokenPair
    const { accessToken, refreshToken } = jwt.generateTokenPair(
      user.id, 
      user.email,
      user.org_id  // ← ADD THIS
    );

    const { password_hash, two_factor_secret, password_reset_token, ...safeUser } = user;

    res.json({
      success: true,
      data: { user: safeUser, accessToken, refreshToken }
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    next(err);
  }
};

exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token required' });
    }
    const decoded = jwt.verifyToken(refreshToken);
    const { accessToken, refreshToken: newRefresh } = jwt.generateTokenPair(decoded.userId, decoded.email);
    res.json({ success: true, data: { accessToken, refreshToken: newRefresh } });
  } catch (err) { next(err); }
};

exports.logout = (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
};
