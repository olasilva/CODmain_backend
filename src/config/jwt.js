// src/config/jwt.js
require('dotenv').config();

/**
 * Single source of truth for JWT config.
 * Both the signer (controller) and the verifier (middleware) import from here.
 */
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set in .env — using insecure dev fallback.');
  console.warn('⚠️  Set a strong JWT_SECRET before deploying to production.');
}

module.exports = { JWT_SECRET, JWT_EXPIRY };