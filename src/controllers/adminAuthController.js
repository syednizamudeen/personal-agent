const express = require('express');
const prisma = require('../db/prisma');
const { verifyPassword } = require('../services/authService');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');

const router = express.Router();

router.post('/login', async (req, res) => {
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
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireSuperAdmin, (req, res) => {
  res.json({ id: req.superAdmin.id, email: req.superAdmin.email, name: req.superAdmin.name });
});

module.exports = router;
