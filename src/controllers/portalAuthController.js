const express = require('express');
const prisma = require('../db/prisma');
const { verifyPassword, hashPassword } = require('../services/authService');
const { issueResetToken, consumeResetToken } = require('../services/passwordResetService');
const { sendPasswordResetEmail } = require('../services/emailService');
const requireTenantSession = require('../middleware/requireTenantSession');
const { appBaseUrl } = require('../config/env');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const tenant = await prisma.tenant.findUnique({ where: { loginEmail: email } });
  if (!tenant || !(await verifyPassword(password, tenant.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (tenant.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'Account suspended' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    req.session.tenantId = tenant.id;
    res.json({ tenantId: tenant.id });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireTenantSession, (req, res) => {
  res.json({ id: req.tenant.id, name: req.tenant.name, loginEmail: req.tenant.loginEmail, rateLimitHours: req.tenant.rateLimitHours });
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const tenant = await prisma.tenant.findUnique({ where: { loginEmail: email } });
  if (tenant) {
    const token = await issueResetToken('TENANT', tenant.id);
    const resetUrl = `${appBaseUrl}/portal/reset-password?token=${token}`;
    await sendPasswordResetEmail(tenant.loginEmail, resetUrl);
  }
  res.json({ ok: true });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  const result = await consumeResetToken(token);
  if (!result || result.actorType !== 'TENANT') {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }
  const passwordHash = await hashPassword(password);
  await prisma.tenant.update({ where: { id: result.actorId }, data: { passwordHash } });
  res.json({ ok: true });
});

router.patch('/change-password', requireTenantSession, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!(await verifyPassword(currentPassword, req.tenant.passwordHash))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.tenant.update({ where: { id: req.tenant.id }, data: { passwordHash } });
  res.json({ ok: true });
});

module.exports = router;
