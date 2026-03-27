const express = require('express');
const router = express.Router();
const { registerClient, loginClient, getClientProfile } = require('../controllers/clientAuthController');
const { protectClient } = require('../middleware/clientAuth');

router.post('/register', registerClient);
router.post('/login', loginClient);
router.get('/me', protectClient, getClientProfile);

module.exports = router;
