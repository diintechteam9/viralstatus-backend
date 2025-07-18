const express = require('express');
const router = express.Router();
const creditWalletController = require('../controllers/creditWalletController');

// Sync wallet with approved user responses
router.post('/sync/:userId', creditWalletController.syncCreditWallet);

// Fetch wallet info
router.get('/:userId', creditWalletController.getCreditWallet);

module.exports = router;

