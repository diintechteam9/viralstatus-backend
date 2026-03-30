const express = require('express');
const router = express.Router();
const { registerClient, loginClient, getClientProfile } = require('../controllers/clientAuthController');
const { authenticate, authorize } = require('../middleware/authenticate');

// Public routes
router.post('/register', registerClient);
router.post('/login', loginClient);

// Protected routes
router.get('/me', authenticate, authorize('client', 'admin', 'super_admin'), getClientProfile);

module.exports = router;
