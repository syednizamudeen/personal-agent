const express = require('express');
const prisma = require('../db/prisma');
const { verifyPassword, hashPassword } = require('../services/authService');
const { issueResetToken, consumeResetToken } = require('../services/passwordResetService');
const { sendPasswordResetEmail } = require('../services/emailService');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const { appBaseUrl } = require('../config/env');
const asyncHandler = require('../middleware/asyncHandler');

const MIN_PASSWORD_LENGTH = 8;

const router = express.Router();

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const superAdmin = await prisma.superAdmin.findUnique({ where: { email } });
    if (!superAdmin || !(await verifyPassword(password, superAdmin.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      req.session.superAdminId = superAdmin.id;
      res.json({ superAdminId: superAdmin.id });
    });
  })
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', asyncHandler(requireSuperAdmin), (req, res) => {
  res.json({ id: req.superAdmin.id, email: req.superAdmin.email, name: req.superAdmin.name });
});

router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    const superAdmin = await prisma.superAdmin.findUnique({ where: { email } });
    if (superAdmin) {
      const token = await issueResetToken('SUPER_ADMIN', superAdmin.id);
      const resetUrl = `${appBaseUrl}/admin/reset-password?token=${token}`;
      await sendPasswordResetEmail(superAdmin.email, resetUrl);
    }
    res.json({ ok: true });
  })
);

router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const result = await consumeResetToken(token);
    if (!result || result.actorType !== 'SUPER_ADMIN') {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    const passwordHash = await hashPassword(password);
    await prisma.superAdmin.update({ where: { id: result.actorId }, data: { passwordHash } });
    res.json({ ok: true });
  })
);

module.exports = router;
