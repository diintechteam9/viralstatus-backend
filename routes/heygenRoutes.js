const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { generateVideo, getVideoStatus } = require('../controllers/aivideogen/heygenVideoController');

// Generate video endpoint
router.post('/generate-video', protect, generateVideo);

// Get video status endpoint
router.get('/video-status/:videoId', protect, getVideoStatus);

module.exports = router;

