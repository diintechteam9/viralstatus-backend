const express = require('express');
const router = express.Router();
const { analyzeWebsite, getScreenshot, getHistory, deleteHistory } = require('../controllers/websiteAnalyzerController');

// Analyze website
router.post('/analyze', analyzeWebsite);

// Get history
router.get('/history', getHistory);

// Delete history item
router.delete('/history/:id', deleteHistory);

// Get screenshot
router.get('/screenshot/:filename', getScreenshot);

module.exports = router;
