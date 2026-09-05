const express = require('express');
const prisma = require('../db/prisma');
const { verifyPassword } = require('../services/authService');
const requireTenantSession = require('../middleware/requireTenantSession');

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

module.exports = router;
