const express = require('express');
const portalAuthController = require('../controllers/portalAuthController');
const requireTenantSession = require('../middleware/requireTenantSession');
const sessionController = require('../controllers/sessionController');
const reviewController = require('../controllers/reviewController');

const router = express.Router();
router.use('/', portalAuthController);

router.use(requireTenantSession);

router.post('/sessions', sessionController.createSession);
router.get('/sessions/:sessionId', sessionController.getSessionStatus);
router.post('/sessions/:sessionId/reconnect', async (req, res) => {
  const { reconnectSession } = require('../services/baileysManager');
  await reconnectSession(req.tenant.id, req.params.sessionId);
  res.json({ ok: true });
});
router.get('/messages', sessionController.listMessageLogs);
router.get('/corrections', reviewController.listCorrections);
router.post('/corrections', reviewController.createCorrection);
router.delete('/corrections/:ruleId', reviewController.deleteCorrection);

module.exports = router;
