const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/activityController');
const { authenticate, authorize } = require('../middleware/authenticate');

// Home screen stats — user calls with their userId
router.get('/stats/:userId', ctrl.getHomeStats);

// Live activity feed — public read (android home)
router.get('/', ctrl.getLiveActivity);

module.exports = router;
