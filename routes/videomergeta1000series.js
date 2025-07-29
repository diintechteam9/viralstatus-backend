const express = require('express');
const router = express.Router();
const { mergeReel } = require('../controllers/videomergeta1000seriescontroller');

// Simple test endpoint
router.get('/test', (req, res) => {
  console.log('Test endpoint called');
  res.header('Access-Control-Allow-Origin', 'https://viralstatus-frontend.vercel.app');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.json({ message: 'Test endpoint working', timestamp: new Date().toISOString() });
});

// Handle CORS preflight requests
router.options('/merge-reelta1000series', (req, res) => {
  console.log('CORS preflight request received');
  res.header('Access-Control-Allow-Origin', 'https://viralstatus-frontend.vercel.app');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.status(200).end();
});

// POST /api/reelta1000series/merge-reelta1000series
router.post('/merge-reelta1000series', (req, res, next) => {
  console.log('POST request received for merge-reelta1000series');
  // Add CORS headers for the actual request
  res.header('Access-Control-Allow-Origin', 'https://viralstatus-frontend.vercel.app');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Set a longer timeout for video processing (10 minutes)
  req.setTimeout(10 * 60 * 1000);
  res.setTimeout(10 * 60 * 1000);
  
  next();
}, express.json({limit: '200mb'}), mergeReel);

module.exports = router; 