const { v4: uuid } = require('uuid');
const { read, write } = require('../services/localStore');

async function createApplication(req, res) {
  const { studentName, guardianEmail, course, trackName } = req.body;
  if (!studentName || !guardianEmail || !course || !trackName) return res.status(400).json({ error: 'Student, guardian email, course, and track are required' });
  const store = read();
  const application = { ...req.body, id: uuid(), status: 'awaiting_payment', createdAt: new Date().toISOString() };
  store.applications.push(application);
  write(store);
  res.status(201).json(application);
}

async function createPayment(req, res) {
  const { applicationId, amountPaid, paymentMethod, plan } = req.body;
  if (!applicationId || !amountPaid || !paymentMethod || !plan) return res.status(400).json({ error: 'Payment details are required' });
  const store = read();
  const payment = { id: uuid(), applicationId, amountPaid, paymentMethod, plan, status: 'paid', transactionId: `COD-${Date.now().toString().slice(-8)}`, paidAt: new Date().toISOString() };
  store.payments.push(payment);
  const application = store.applications.find((item) => item.id === applicationId);
  if (application) application.status = 'submitted';
  write(store);
  res.status(201).json(payment);
}

async function contact(req, res) {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'Name, email, and message are required' });
  const store = read();
  store.messages.push({ id: uuid(), name, email, message, createdAt: new Date().toISOString() });
  write(store);
  res.status(201).json({ ok: true });
}

async function newsletter(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const store = read();
  if (!store.subscribers.includes(email)) store.subscribers.push(email);
  write(store);
  res.status(201).json({ ok: true });
}

module.exports = { createApplication, createPayment, contact, newsletter };
