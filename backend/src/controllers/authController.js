const User = require('../models/User');
const jwt = require('../utils/jwt');
const logger = require('../utils/logger');

exports.register = async (req, res, next) => {
  try {
    const { email, password, first_name, last_name } = req.body;
    const existing = await User.findByEmail(email);
    if (existing) return res.status(409).json({ success: false, message: 'Email already registered' });

    const user = await User.create(email, password, first_name, last_name);
    const { accessToken, refreshToken } = jwt.generateTokenPair(user.id, user.email);

    res.status(201).json({ success: true, data: { user, accessToken, refreshToken } });
  } catch (err) { next(err); }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findByEmail(email);
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const valid = await User.verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    if (!user.is_active) return res.status(401).json({ success: false, message: 'Account inactive' });

    const { accessToken, refreshToken } = jwt.generateTokenPair(user.id, user.email);
    const { password_hash, ...safeUser } = user;

    res.json({ success: true, data: { user: safeUser, accessToken, refreshToken } });
  } catch (err) { next(err); }
};

exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: 'Refresh token required' });

    const decoded = jwt.verifyToken(refreshToken);
    if (decoded.type !== 'refresh') return res.status(401).json({ success: false, message: 'Invalid token type' });

    const { accessToken, refreshToken: newRefresh } = jwt.generateTokenPair(decoded.userId, decoded.email);
    res.json({ success: true, data: { accessToken, refreshToken: newRefresh } });
  } catch (err) { next(err); }
};

exports.logout = (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
};