const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { generateImportantParagraphs, trimByParagraphs, streamSegment, cleanupJob } = require("../controllers/videotosegmentscontroller");

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

const upload = multer({
  storage,
  limits: {
    fieldSize: 50 * 1024 * 1024,
  }
});

// JSON body for important paragraphs
router.post('/important-paragraphs', express.json({ limit: '10mb' }), generateImportantParagraphs);

// Multipart for trim by paragraphs
router.post('/trim', upload.single('video'), trimByParagraphs);

// Stream individual segment
router.get('/segment/:jobId/:index', streamSegment);

// Cleanup job directory
router.post('/cleanup/:jobId', cleanupJob);

module.exports = router;


