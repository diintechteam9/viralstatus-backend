const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/kycController');
const { authenticate, authorize } = require('../middleware/authenticate');

const adminOnly  = [authenticate, authorize('admin', 'super_admin')];
const mobileOnly = [authenticate, authorize('mobileuser')];

// Admin routes
router.get('/',                 ...adminOnly,  ctrl.listKYC);
router.patch('/review/:userId', ...adminOnly,  ctrl.reviewKYC);

// User routes — userId from token
router.post('/submit',          ...mobileOnly, ctrl.submitKYC);
router.get('/me',               ...mobileOnly, ctrl.getKYC);

module.exports = router;
