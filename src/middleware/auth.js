const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET && !process.env.JWT_SECRET.includes('your_')
  ? process.env.JWT_SECRET
  : 'development-only-change-me';

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, secret, {
    expiresIn: process.env.JWT_EXPIRY || '7d',
  });
}

function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireStaffOrAdmin(req, res, next) {
  if (!['staff', 'admin'].includes(req.user?.role)) return res.status(403).json({ error: 'Staff access required' });
  next();
}

module.exports = { authenticateToken, requireAdmin, requireStaffOrAdmin, signToken };
