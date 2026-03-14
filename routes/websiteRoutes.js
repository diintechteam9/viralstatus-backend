const express = require('express');
const router = express.Router();
const websiteController = require('../controllers/websiteController');

// POST /api/website/analyze
router.post('/analyze', websiteController.analyzeWebsite);

// GET /api/website/history - recent analyses
router.get('/history', websiteController.listAnalyses);

module.exports = router;
