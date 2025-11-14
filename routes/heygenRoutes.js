const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { generateVideo, getVideoStatus, startAvatarGeneration, getAvatarGenerationStatus, generateVideoFromAvatar, getVideoTaskStatus } = require('../controllers/aivideogen/heygenVideoController');

// Generate video endpoint
router.post('/generate-video', generateVideo);

// Get video status endpoint
router.get('/video-status/:videoId', getVideoStatus);

// Get video task status (v2) endpoint
router.get('/video-task-status/:taskId', getVideoTaskStatus);

// Start avatar generation (non-blocking)
router.post('/avatar/start', startAvatarGeneration);

// Check avatar generation status
router.get('/avatar/status/:generationId', getAvatarGenerationStatus);

// Generate video from existing photo avatar id
router.post('/generate-video-from-avatar', generateVideoFromAvatar);

module.exports = router;

