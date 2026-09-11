// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRY } = require('../config/jwt');

/**
 * Sign a JWT for a user.
 * Payload uses `id` — but the verifier accepts both `id` and `userId`
 * so tokens signed before this change still work.
 */
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Verify the Bearer token and attach a normalized req.user.
 */
function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Accept both payload shapes: { id } (new) and { userId } (legacy)
    const id = decoded.id || decoded.userId;

    if (!id) {
      return res.status(401).json({ error: 'Token missing user id' });
    }

    req.user = {
      id,
      userId: id,       // Alias so controllers using either name still work
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireStaffOrAdmin(req, res, next) {
  if (!['staff', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Staff access required' });
  }
  next();
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireStaffOrAdmin,
  signToken,
};