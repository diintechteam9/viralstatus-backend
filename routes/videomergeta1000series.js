const express = require('express');
const router = express.Router();
const { mergeReel } = require('../controllers/videomergeta1000seriescontroller');

// POST /api/ta1000series/merge-reel
router.post('/merge-reelta1000series', express.json({limit: '100mb'}), mergeReel);

module.exports = router; 