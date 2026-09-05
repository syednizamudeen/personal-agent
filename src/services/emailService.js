const nodemailer = require('nodemailer');
const { smtp } = require('../config/env');
const logger = require('../config/logger');

const transporter = nodemailer.createTransport({
  host: smtp.host,
  port: smtp.port,
  auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
});

async function send(to, subject, html) {
  if (!smtp.host) {
    logger.warn({ to, subject }, 'SMTP not configured, skipping email send');
    return;
  }
  await transporter.sendMail({ from: smtp.from, to, subject, html });
}

async function sendPasswordResetEmail(to, resetUrl) {
  await send(
    to,
    'Reset your password',
    `<p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
  );
}

async function sendDisconnectAlertEmail(to, tenantName) {
  await send(
    to,
    'WhatsApp Disconnected',
    `<p>The WhatsApp connection for <strong>${tenantName}</strong> was disconnected and needs to be re-linked. Log in to the portal and click "Reconnect device" to generate a new QR code.</p>`
  );
}

module.exports = { sendPasswordResetEmail, sendDisconnectAlertEmail };
