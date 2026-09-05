const express = require('express');
const adminAuthController = require('../controllers/adminAuthController');

const router = express.Router();
router.use('/', adminAuthController);

module.exports = router;
