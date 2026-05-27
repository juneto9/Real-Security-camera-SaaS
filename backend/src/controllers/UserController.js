const User = require('../models/User');
const bcrypt = require('bcrypt');
const config = require('../config');

exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
};

exports.updateMe = async (req, res, next) => {
  try {
    const user = await User.update(req.user.id, req.body);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    const user = await User.findByEmail(req.user.email);
    const valid = await User.verifyPassword(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Current password incorrect' });

    const hashed = await bcrypt.hash(new_password, config.SECURITY.bcryptRounds);
    await require('../utils/database').query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hashed, req.user.id]
    );
    res.json({ success: true, message: 'Password updated' });
  } catch (err) { next(err); }
};