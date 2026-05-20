const express = require('express');
const router = express.Router();
const { registerClient, loginClient, getClientProfile, getClientToken } = require('../controllers/clientAuthController');
const { authenticate, authorize } = require('../middleware/authenticate');

// Public routes
router.post('/register', registerClient);
router.post('/login', loginClient);

// Internal — get token by MongoDB client _id (protected by x-internal-secret header)
router.get('/get-client-token/:clientMongoId', getClientToken);

// Protected routes
router.get('/me', authenticate, authorize('client', 'admin', 'super_admin'), getClientProfile);

module.exports = router;
