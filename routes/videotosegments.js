const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { generateImportantParagraphs, trimByParagraphs, streamSegment, cleanupJob, generateSentenceSrt, generateWordSrt } = require("../controllers/videotosegmentscontroller");
const { createAsyncSegmentsJob, getJobStatus: getAsyncJobStatus, cleanupJob: cleanupAsyncJob } = require("../controllers/videoToSegmentsAsyncController");

const router = express.Router();

// Reuse temp uploads directory
const uploadDir = path.join("temp", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

// Sanitize filename to avoid long names
const sanitizeFilename = (filename, maxLength = 50) => {
  if (!filename || typeof filename !== 'string') {
    return `video_${Date.now()}`;
  }
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);
  const sanitized = nameWithoutExt
    .replace(/[^\w\s\-_]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, Math.max(1, maxLength - ext.length))
    .replace(/_+$/, '');
  const finalName = sanitized || `video_${Date.now()}`;
  return finalName + ext;
};

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const sanitized = sanitizeFilename(file.originalname, 30);
    const ext = path.extname(sanitized);
    const base = path.basename(sanitized, ext);
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  // Allow video files for 'video' and 'outro' fields
  if ((file.fieldname === 'video' || file.fieldname === 'outro') && file.mimetype.startsWith('video/')) {
    cb(null, true);
  }
  // Allow image files for 'logo' field
  else if (file.fieldname === 'logo' && file.mimetype.startsWith('image/')) {
    cb(null, true);
  }
  // Reject other file types
  else {
    cb(new Error(`Invalid file type for field '${file.fieldname}'. Expected ${file.fieldname === 'logo' ? 'image' : 'video'} file.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fieldSize: 50 * 1024 * 1024,
  }
});

// JSON body for important paragraphs
router.post('/important-paragraphs', express.json({ limit: '10mb' }), generateImportantParagraphs);

// SRT generation endpoints (Deepgram-backed)
router.post('/generate-srt', express.json({ limit: '20mb' }), generateSentenceSrt);
router.post('/generate-srt-words', express.json({ limit: '20mb' }), generateWordSrt);

// Multipart for trim by paragraphs (supports optional outro video and logo image)
router.post('/trim', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'outro', maxCount: 1 },
  { name: 'logo', maxCount: 1 }
]), trimByParagraphs);

// Async job endpoints
router.post('/generate-segments-async', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'outro', maxCount: 1 },
  { name: 'logo', maxCount: 1 }
]), createAsyncSegmentsJob);
router.get('/job-status/:jobId', getAsyncJobStatus);
router.post('/cleanup-job/:jobId', cleanupAsyncJob);

// Stream individual segment
router.get('/segment/:jobId/:index', streamSegment);

// Cleanup job directory
router.post('/cleanup/:jobId', cleanupJob);

module.exports = router;