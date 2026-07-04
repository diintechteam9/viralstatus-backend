const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/withdrawController');
const { authenticate, authorize } = require('../middleware/authenticate');

const adminOnly = [authenticate, authorize('admin', 'super_admin')];

// Admin routes — MUST be before /:userId to avoid Express matching 'admin' as userId
router.get('/admin/list',           ...adminOnly, ctrl.listWithdrawals);
router.patch('/admin/:requestId',   ...adminOnly, ctrl.processWithdrawal);

// User
router.post('/',             ctrl.requestWithdraw);
router.get('/:userId',       ctrl.getUserWithdrawals);

module.exports = router;
