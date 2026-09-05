const express = require('express');
const portalAuthController = require('../controllers/portalAuthController');

const router = express.Router();
router.use('/', portalAuthController);

module.exports = router;
