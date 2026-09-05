const express = require('express');
const adminAuthController = require('../controllers/adminAuthController');
const requireSuperAdmin = require('../middleware/requireSuperAdmin');
const adminTenantController = require('../controllers/adminTenantController');

const router = express.Router();
router.use('/', adminAuthController);

router.use(requireSuperAdmin);

router.get('/tenants', adminTenantController.listTenants);
router.post('/tenants', adminTenantController.createTenant);
router.get('/tenants/:id', adminTenantController.getTenant);
router.patch('/tenants/:id', adminTenantController.updateTenant);
router.post('/tenants/:id/send-password-reset', adminTenantController.sendTenantPasswordReset);

module.exports = router;
