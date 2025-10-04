const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { extractAudio, generateSentenceSrt, generateWordSrt, generateImportantSentences, generateReel, generateImagePromptsForParagraph, overlayImagesOnVideo } = require("../controllers/videoToReelsController");
const { createAsyncReelJob, getJobStatus, cleanupJob } = require("../controllers/videoToReelsAsyncController");

// Utility function to sanitize and truncate filenames
const sanitizeFilename = (filename, maxLength = 50) => {
  if (!filename || typeof filename !== 'string') {
    return `video_${Date.now()}`;
  }
  
  // Remove extension first
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);
  
  // Sanitize: remove special characters, keep only alphanumeric, spaces, hyphens, underscores
  const sanitized = nameWithoutExt
    .replace(/[^\w\s\-_]/g, '') // Remove special characters except word chars, spaces, hyphens, underscores
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .substring(0, maxLength - ext.length) // Truncate to fit within maxLength including extension
    .replace(/_+$/, ''); // Remove trailing underscores
  
  // Ensure we have a valid name
  const finalName = sanitized || `video_${Date.now()}`;
  return finalName + ext;
};

const router = express.Router();

// Configure multer to store uploads temporarily
const uploadDir = path.join("temp", "uploads");
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
    fieldSize: 50 * 1024 * 1024, // allow large JSON/text fields (e.g., images data URLs)
  }
});

// POST /api/vtr/extract-audio
router.post("/extract-audio", upload.single("video"), extractAudio);

// POST /api/vtr/generate-srt (expects { audio: <base64> })
router.post("/generate-srt", express.json({ limit: '50mb' }), generateSentenceSrt);

// POST /api/vtr/generate-srt-words (expects { audio: <base64> })
router.post("/generate-srt-words", express.json({ limit: '50mb' }), generateWordSrt);

// POST /api/vtr/important-sentences (expects { srt: string, count?: number })
router.post("/important-sentences", express.json({ limit: '5mb' }), generateImportantSentences);

// POST /api/vtr/generate-reel with fields: video (file), srt (text), sentences (json array)
router.post("/generate-reel", upload.single("video"), generateReel);

// POST /api/vtr/generate-reel-async with fields: video (file), srt (text), sentences (json array)
router.post("/generate-reel-async", upload.single("video"), createAsyncReelJob);

// GET /api/vtr/job-status/:jobId
router.get("/job-status/:jobId", getJobStatus);

// POST /api/vtr/cleanup-job/:jobId
router.post("/cleanup-job/:jobId", cleanupJob);

// POST /api/vtr/generate-image-prompts (expects { paragraph: string, max?: 1-5 })
router.post("/generate-image-prompts", express.json({ limit: '2mb' }), generateImagePromptsForParagraph);

// POST /api/vtr/overlay-images (expects JSON: { videoUrl: string, images: string[] })
router.post("/overlay-images", express.json({ limit: '50mb' }), overlayImagesOnVideo);

// GET /api/vtr/test-ffmpeg - Test endpoint to verify FFmpeg setup
router.get("/test-ffmpeg", (req, res) => {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  try {
    const ffmpeg = require("fluent-ffmpeg");
    const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
    const ffprobeStatic = require("ffprobe-static");

    console.log('[test-ffmpeg] FFmpeg paths:', {
      ffmpeg: ffmpegInstaller?.path,
      ffprobe: ffprobeStatic?.path
    });

    // Test FFmpeg version
    ffmpeg.getAvailableFormats((err, formats) => {
      if (err) {
        console.error('[test-ffmpeg] FFmpeg error:', err.message);
        return res.status(500).json({
          success: false,
          error: 'FFmpeg not working',
          details: err.message,
          paths: {
            ffmpeg: ffmpegInstaller?.path,
            ffprobe: ffprobeStatic?.path
          }
        });
      }

      console.log('[test-ffmpeg] FFmpeg working, available formats:', Object.keys(formats).length);
      res.json({
        success: true,
        message: 'FFmpeg is working',
        availableFormats: Object.keys(formats).length,
        paths: {
          ffmpeg: ffmpegInstaller?.path,
          ffprobe: ffprobeStatic?.path
        }
      });
    });
  } catch (error) {
    console.error('[test-ffmpeg] Setup error:', error.message);
    res.status(500).json({
      success: false,
      error: 'FFmpeg setup error',
      details: error.message
    });
  }
});

module.exports = router;


