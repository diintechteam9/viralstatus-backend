const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/withdrawController');
const { authenticate, authorize } = require('../middleware/authenticate');

const adminOnly  = [authenticate, authorize('admin', 'super_admin')];
const mobileOnly = [authenticate, authorize('mobileuser')];

// Admin routes
router.get('/admin/list',         ...adminOnly, ctrl.listWithdrawals);
router.patch('/admin/:requestId', ...adminOnly, ctrl.processWithdrawal);

// User — auth required, userId from token
router.post('/',       ...mobileOnly, ctrl.requestWithdraw);
router.get('/history', ...mobileOnly, ctrl.getUserWithdrawals);

module.exports = router;
