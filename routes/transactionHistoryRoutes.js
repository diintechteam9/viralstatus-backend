const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/transactionHistoryController');
const { authenticate, authorize } = require('../middleware/authenticate');

const mobileOnly = [authenticate, authorize('mobileuser')];
const adminOnly = [authenticate, authorize('admin', 'super_admin')];

// User routes — auth required, userId from token
router.get('/', ...mobileOnly, ctrl.getTransactionHistory);
router.get('/stats', ...mobileOnly, ctrl.getTransactionStats);
router.get('/earnings', ...mobileOnly, ctrl.getEarnings);
router.get('/penalties', ...mobileOnly, ctrl.getPenalties);
router.get('/summary', ...mobileOnly, ctrl.getTransactionSummary);

// Admin routes — create transaction (internal use)
router.post('/', ...adminOnly, ctrl.createTransaction);

module.exports = router;
