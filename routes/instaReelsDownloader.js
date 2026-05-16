const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  getReelInfo,
  thumbnailProxy,
  downloadReel,
} = require("../controllers/instaReelsDownloaderController");

const router = express.Router();

// Rate limiter: 30 requests per minute per IP
const reelsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." },
});

// Download has stricter limit: 10 per minute
const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many download requests. Please wait a minute." },
});

// POST /api/insta-reels/get-info
router.post("/get-info", reelsLimiter, getReelInfo);

// GET /api/insta-reels/thumbnail?url=...
router.get("/thumbnail", thumbnailProxy);

// GET /api/insta-reels/download?url=...&title=...
router.get("/download", downloadLimiter, downloadReel);

module.exports = router;
