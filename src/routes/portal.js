const express = require('express');
const portalAuthController = require('../controllers/portalAuthController');
const requireTenantSession = require('../middleware/requireTenantSession');
const asyncHandler = require('../middleware/asyncHandler');
const {
  listContactFilters,
  createContactFilter,
  deleteContactFilter,
} = require('../controllers/contactFilterController');
const sessionController = require('../controllers/sessionController');
const reviewController = require('../controllers/reviewController');

const router = express.Router();
router.use('/', portalAuthController);

router.use(asyncHandler(requireTenantSession));

router.post('/sessions', asyncHandler(sessionController.createSession));
router.get('/sessions', asyncHandler(sessionController.listSessions));
router.get('/sessions/:sessionId', asyncHandler(sessionController.getSessionStatus));
router.post(
  '/sessions/:sessionId/reconnect',
  asyncHandler(async (req, res) => {
    const { reconnectSession } = require('../services/baileysManager');
    await reconnectSession(req.tenant.id, req.params.sessionId);
    res.json({ ok: true });
  })
);
router.get('/messages', asyncHandler(sessionController.listMessageLogs));
router.get('/corrections', asyncHandler(reviewController.listCorrections));
router.post('/corrections', asyncHandler(reviewController.createCorrection));
router.delete('/corrections/:ruleId', asyncHandler(reviewController.deleteCorrection));

router.get('/contact-filters', asyncHandler((req, res) => listContactFilters(req.tenant.id, res)));
router.post('/contact-filters', asyncHandler((req, res) => createContactFilter(req.tenant.id, req.body, res)));
router.delete(
  '/contact-filters/:filterId',
  asyncHandler((req, res) => deleteContactFilter(req.tenant.id, req.params.filterId, res))
);

module.exports = router;
