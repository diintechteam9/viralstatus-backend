const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/kycController');
const { authenticate, authorize } = require('../middleware/authenticate');

const adminOnly = [authenticate, authorize('admin', 'super_admin')];

// Admin routes — MUST be before /:userId
router.get('/',                 ...adminOnly, ctrl.listKYC);
router.patch('/review/:userId', ...adminOnly, ctrl.reviewKYC);

// User routes
router.post('/submit',          ctrl.submitKYC);   // multipart/form-data
router.get('/:userId',          ctrl.getKYC);

module.exports = router;
