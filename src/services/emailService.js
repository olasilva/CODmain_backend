// src/services/emailService.js
const nodemailer = require('nodemailer');

// ─── Transporter ───
// Port 465 uses implicit TLS (secure: true)
// Port 587 uses STARTTLS (secure: false)
// If one is blocked by your network, try the other.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  secure: Number(process.env.SMTP_PORT || 465) === 465, // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Give the connection more time — ETIMEOUT often just means the default
  // timeout was too short for a slow network.
  connectionTimeout: 20000, // 20s
  greetingTimeout: 20000,
  socketTimeout: 30000,
  // Some networks have self-signed certs in the middle — this stops
  // Nodemailer from rejecting the handshake.
  tls: {
    rejectUnauthorized: false,
  },
});

// ─── Startup check ───
// Runs once at boot so you know immediately if SMTP is reachable.
// (Not required, but very helpful for debugging.)
(async () => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠️ SMTP not configured — emails will be skipped');
    return;
  }
  try {
    await transporter.verify();
    console.log(
      `✅ SMTP ready — ${process.env.SMTP_HOST || 'smtp.gmail.com'}:${
        process.env.SMTP_PORT || 465
      }`
    );
  } catch (err) {
    console.error('❌ SMTP verify failed:', err.message);
    console.error(
      '   → Check .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (App Password)'
    );
    console.error(
      '   → Try switching SMTP_PORT between 465 (secure) and 587 (STARTTLS)'
    );
  }
})();

// ─── sendMail ───
async function sendMail({ to, subject, html, text }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠️ SMTP not configured — skipping email to', to);
    return null;
  }

  if (!to) {
    console.warn('⚠️ sendMail called without a recipient — skipping');
    return null;
  }

  try {
    const info = await transporter.sendMail({
      from:
        process.env.SMTP_FROM ||
        `"Clan of David Academy" <${process.env.SMTP_USER}>`,
      to,
      subject: subject || '(no subject)',
      html: html || text || '',
      text: text || (html ? html.replace(/<[^>]*>/g, '') : ''),
    });
    console.log('📧 Email sent to', to, '–', info.messageId);
    return info;
  } catch (err) {
    console.error('❌ Email send failed:', err.message);
    if (err.code) console.error('   code:', err.code);
    if (err.command) console.error('   command:', err.command);
    if (err.responseCode) console.error('   responseCode:', err.responseCode);
    return null;
  }
}

module.exports = { sendMail };