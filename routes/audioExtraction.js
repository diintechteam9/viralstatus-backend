const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createAsyncAudioExtractionJob, getJobStatus, cleanupJob } = require('../controllers/audioExtractionAsyncController');

const router = express.Router();

// Utility function to sanitize filenames
const sanitizeFilename = (filename, maxLength = 30) => {
  if (!filename || typeof filename !== 'string') {
    return `video_${Date.now()}`;
  }
  
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);
  
  const sanitized = nameWithoutExt
    .replace(/[^\w\s\-_]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, maxLength - ext.length)
    .replace(/_+$/, '');
  
  const finalName = sanitized || `video_${Date.now()}`;
  return finalName + ext;
};

// Create upload directory
const uploadDir = path.join(__dirname, '..', 'temp', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Sanitize the filename to prevent ENAMETOOLONG errors
    const sanitized = sanitizeFilename(file.originalname, 30);
    const ext = path.extname(sanitized);
    const base = path.basename(sanitized, ext);
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for video files
  }
});

// POST /api/audio/extract-async - Create async audio extraction job
router.post("/extract-async", upload.single("video"), createAsyncAudioExtractionJob);

// GET /api/audio/job-status/:jobId - Get job status
router.get("/job-status/:jobId", getJobStatus);

// POST /api/audio/cleanup-job/:jobId - Clean up job files
router.post("/cleanup-job/:jobId", cleanupJob);

module.exports = router;
