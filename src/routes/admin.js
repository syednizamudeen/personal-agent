const express = require('express');
const adminAuthController = require('../controllers/adminAuthController');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const adminTenantController = require('../controllers/adminTenantController');
const adminTenantDataController = require('../controllers/adminTenantDataController');
const adminAuditController = require('../controllers/adminAuditController');
const adminHealthController = require('../controllers/adminHealthController');
const adminSuperAdminController = require('../controllers/adminSuperAdminController');

const router = express.Router();
router.use('/', adminAuthController);

router.use(requireSuperAdmin);

router.get('/tenants', adminTenantController.listTenants);
router.post('/tenants', adminTenantController.createTenant);
router.get('/tenants/:id', adminTenantController.getTenant);
router.patch('/tenants/:id', adminTenantController.updateTenant);
router.post('/tenants/:id/send-password-reset', adminTenantController.sendTenantPasswordReset);

router.get('/tenants/:id/messages', adminTenantDataController.listTenantMessages);
router.get('/tenants/:id/corrections', adminTenantDataController.listTenantCorrections);
router.post('/tenants/:id/corrections', adminTenantDataController.createTenantCorrection);
router.delete('/tenants/:id/corrections/:ruleId', adminTenantDataController.deleteTenantCorrection);
router.get('/tenants/:id/sessions', adminTenantDataController.listTenantSessions);
router.post('/tenants/:id/sessions/:sessionId/reconnect', adminTenantDataController.reconnectTenantSession);

router.get('/audit-logs', adminAuditController.listAuditLogs);
router.get('/super-admins', adminSuperAdminController.listSuperAdmins);
router.post('/super-admins', adminSuperAdminController.createSuperAdmin);
router.get('/system/health', adminHealthController.getSystemHealth);

module.exports = router;
