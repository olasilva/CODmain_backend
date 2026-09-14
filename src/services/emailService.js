// src/services/emailService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // STARTTLS on 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail({ to, subject, html, text }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠️ SMTP not configured — skipping email to', to);
    return null;
  }
  try {
    const info = await transporter.sendMail({
      from:
        process.env.SMTP_FROM ||
        `"Clan of David Academy" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });
    console.log('📧 Email sent to', to, '–', info.messageId);
    return info;
  } catch (err) {
    console.error('❌ Email send failed:', err.message);
    return null;
  }
}

module.exports = { sendMail };