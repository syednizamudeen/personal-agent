const express = require('express');
const adminAuthController = require('../controllers/adminAuthController');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const asyncHandler = require('../middleware/asyncHandler');
const adminTenantController = require('../controllers/adminTenantController');
const adminTenantDataController = require('../controllers/adminTenantDataController');
const adminAuditController = require('../controllers/adminAuditController');
const adminHealthController = require('../controllers/adminHealthController');
const adminSuperAdminController = require('../controllers/adminSuperAdminController');

const router = express.Router();
router.use('/', adminAuthController);

router.use(asyncHandler(requireSuperAdmin));

router.get('/tenants', asyncHandler(adminTenantController.listTenants));
router.post('/tenants', asyncHandler(adminTenantController.createTenant));
router.get('/tenants/:id', asyncHandler(adminTenantController.getTenant));
router.patch('/tenants/:id', asyncHandler(adminTenantController.updateTenant));
router.post('/tenants/:id/send-password-reset', asyncHandler(adminTenantController.sendTenantPasswordReset));

router.get('/tenants/:id/messages', asyncHandler(adminTenantDataController.listTenantMessages));
router.get('/tenants/:id/corrections', asyncHandler(adminTenantDataController.listTenantCorrections));
router.post('/tenants/:id/corrections', asyncHandler(adminTenantDataController.createTenantCorrection));
router.delete('/tenants/:id/corrections/:ruleId', asyncHandler(adminTenantDataController.deleteTenantCorrection));
router.get('/tenants/:id/sessions', asyncHandler(adminTenantDataController.listTenantSessions));
router.post('/tenants/:id/sessions/:sessionId/reconnect', asyncHandler(adminTenantDataController.reconnectTenantSession));

router.get('/audit-logs', asyncHandler(adminAuditController.listAuditLogs));
router.get('/super-admins', asyncHandler(adminSuperAdminController.listSuperAdmins));
router.post('/super-admins', asyncHandler(adminSuperAdminController.createSuperAdmin));
router.get('/system/health', asyncHandler(adminHealthController.getSystemHealth));

module.exports = router;
