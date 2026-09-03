const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { read, write } = require('../services/localStore');
const { signToken } = require('../middleware/auth');

async function register(req, res) {
  const { fullName, email, phone, password, role = 'student' } = req.body;
  if (!fullName || !email || !password) return res.status(400).json({ error: 'Full name, email, and password are required' });
  if (!['student', 'staff'].includes(role)) return res.status(400).json({ error: 'Invalid account role' });
  const store = read();
  const normalizedEmail = email.trim().toLowerCase();
  if (store.users.some((user) => user.email === normalizedEmail)) return res.status(409).json({ error: 'An account with this email already exists.' });
  const user = { id: uuid(), fullName: fullName.trim(), email: normalizedEmail, phone: phone || '', role, passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() };
  store.users.push(user);
  write(store);
  res.status(201).json({ user: publicUser(user), token: signToken(user) });
}

async function login(req, res) {
  const { email, password, role = 'student' } = req.body;
  const store = read();
  const user = store.users.find((item) => item.email === String(email || '').trim().toLowerCase() && item.role === role);
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) return res.status(401).json({ error: 'Invalid email, password, or account type.' });
  res.json({ ...publicUser(user), token: signToken(user) });
}

function publicUser(user) {
  return { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone, role: user.role };
}

module.exports = { register, login };
