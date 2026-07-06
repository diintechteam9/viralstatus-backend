const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/creditWalletController');
const { authenticate, authorize } = require('../middleware/authenticate');

const mobileOnly = [authenticate, authorize('mobileuser')];

// Auth required — userId extracted from token in controller
router.post('/sync', ...mobileOnly, ctrl.syncCreditWallet);
router.get('/',      ...mobileOnly, ctrl.getCreditWallet);

module.exports = router;
