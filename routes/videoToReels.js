const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { extractAudio, generateSentenceSrt, generateWordSrt, generateImportantSentences, generateReel, generateImagePromptsForParagraph, overlayImagesOnVideo } = require("../controllers/videoToReelsController");
const { createAsyncReelJob, getJobStatus, cleanupJob } = require("../controllers/videoToReelsAsyncController");

const router = express.Router();

// Configure multer to store uploads temporarily
const uploadDir = path.join("temp", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
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

module.exports = router;


