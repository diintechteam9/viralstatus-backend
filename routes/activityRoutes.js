const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/activityController');
const { authenticate, authorize } = require('../middleware/authenticate');

const mobileOnly = [authenticate, authorize('mobileuser')];

// User home stats — userId from token
router.get('/stats', ...mobileOnly, ctrl.getHomeStats);

// Live activity feed — auth required
router.get('/', ...mobileOnly, ctrl.getLiveActivity);

module.exports = router;
