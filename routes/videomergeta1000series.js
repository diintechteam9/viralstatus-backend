const express = require('express');
const router = express.Router();
const { mergeReel } = require('../controllers/videomergeta1000seriescontroller');

// Handle CORS preflight requests
router.options('/merge-reelta1000series', (req, res) => {
  res.header('Access-Control-Allow-Origin', 'https://viralstatus-frontend.vercel.app');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

// POST /api/reelta1000series/merge-reelta1000series
router.post('/merge-reelta1000series', express.json({limit: '200mb'}), mergeReel);

module.exports = router; 