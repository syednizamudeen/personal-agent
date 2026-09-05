const express = require('express');
const prisma = require('../db/prisma');
const sessionController = require('../controllers/sessionController');
const reviewController = require('../controllers/reviewController');

const router = express.Router();

// Tenant onboarding has no tenant context yet, so it's exempt from the auth gate below.
router.post('/tenants', sessionController.createTenant);

async function requireTenant(req, res, next) {
  const apiKey = req.header('x-api-key');
  if (!apiKey) return res.status(401).json({ error: 'x-api-key header is required' });

  const tenant = await prisma.tenant.findUnique({ where: { apiKey } });
  if (!tenant) return res.status(401).json({ error: 'Invalid API key' });

  req.tenant = tenant;
  next();
}

router.use(requireTenant);

router.post('/sessions', sessionController.createSession);
router.get('/sessions/:sessionId', sessionController.getSessionStatus);

router.get('/messages', sessionController.listMessageLogs);

router.post('/corrections', reviewController.createCorrection);
router.get('/corrections', reviewController.listCorrections);
router.delete('/corrections/:ruleId', reviewController.deleteCorrection);

module.exports = router;
