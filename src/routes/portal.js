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
router.get('/messages', sessionController.listMessageLogs);
router.get('/corrections', reviewController.listCorrections);
router.post('/corrections', reviewController.createCorrection);
router.delete('/corrections/:ruleId', reviewController.deleteCorrection);

module.exports = router;
