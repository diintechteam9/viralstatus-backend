const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { extractAudio, generateSentenceSrt, generateWordSrt, generateImportantSentences, generateReel } = require("../controllers/videoToReelsController");
const { createAsyncReelJob, getJobStatus } = require("../controllers/videoToReelsAsyncController");

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

const upload = multer({ storage });

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

module.exports = router;


