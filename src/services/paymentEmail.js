// src/services/paymentEmail.js
const { sendMail } = require('./emailService');

function paymentConfirmationHtml({ studentName, programme, amount, reference, loginUrl, guardianEmail }) {
  return `
    <div style="font-family:...">
      <h1>Payment Confirmed</h1>
      <p>Dear ${studentName},</p>
      <p>We've received your payment for <strong>${programme}</strong>.</p>
      <table>... amount, reference, date ...</table>
      <p>Log in to your dashboard:</p>
      <a href="${loginUrl}" style="...">Log in to Dashboard</a>
      <p>Or copy this link: ${loginUrl}</p>
      ...
    </div>
  `;
}

async function sendPaymentConfirmation({ to, studentName, programme, amount, reference }) {
  const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?email=${encodeURIComponent(to)}`;
  return sendMail({
    to,
    subject: `Payment Confirmed – ${programme}`,
    html: paymentConfirmationHtml({ studentName, programme, amount, reference, loginUrl }),
  });
}

module.exports = { sendPaymentConfirmation };