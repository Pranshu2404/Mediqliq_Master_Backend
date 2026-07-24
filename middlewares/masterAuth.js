const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function protect(req, res, next) {
  try {
    const value = String(req.headers.authorization || '');
    const token = value.startsWith('Bearer ') ? value.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user || !user.is_active) return res.status(401).json({ success: false, error: 'Account is unavailable' });
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, error: error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token' });
  }
}

function isMediQliqSuperAdmin(req, res, next) {
  if (req.user?.role !== 'mediqliq_super_admin') return res.status(403).json({ success: false, error: 'MediQliq super admin privileges required' });
  return next();
}

module.exports = { protect, isMediQliqSuperAdmin };
