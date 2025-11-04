const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { generateWordSrt } = require('../controllers/videosubtitlecontroller');
const { createAsyncSubtitleJob, getJobStatus, cleanupJob } = require('../controllers/videosubtitleAsyncController');

const router = express.Router();

// POST /api/subtitles/word-srt - Generate word-level SRT from base64 audio
router.post('/word-srt', generateWordSrt);

// Multer setup for video upload
const uploadDir = path.join(__dirname, '..', 'temp', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadDir); },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '.mp4');
    const base = path.basename(file.originalname || 'video', ext).slice(0, 24).replace(/[^\w\-]+/g, '_');
    cb(null, `${base}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 * 1024 } });

// Async subtitle job endpoints
router.post('/generate-async', upload.single('video'), createAsyncSubtitleJob);
router.get('/job-status/:jobId', getJobStatus);
router.post('/cleanup-job/:jobId', cleanupJob);

module.exports = router;


