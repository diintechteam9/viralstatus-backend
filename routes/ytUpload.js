const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const router = express.Router();
const YouTubeSchedule = require('../models/YouTubeSchedule');
const { protect } = require('../middleware/auth');

// ── Multer setup ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => cb(null, `yt-${Date.now()}-${file.originalname}`),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('video/') ? cb(null, true) : cb(new Error('Only video files allowed'), false);
  },
  limits: { fileSize: 256 * 1024 * 1024 }, // 256MB
});

// ── Helper: upload to YouTube ─────────────────────────────────────────────────
async function uploadToYouTube({ tokens, filePath, title, description, tags, privacy, isShort }) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.CLIENT_SECRET
  );
  auth.setCredentials(tokens);
  const youtube = google.youtube({ version: 'v3', auth });

  const finalTitle = isShort ? `${title} #Shorts` : title;

  const response = await youtube.videos.insert({
    part: 'snippet,status',
    requestBody: {
      snippet: {
        title: finalTitle,
        description: description || title,
        tags: tags || [],
        categoryId: '22',
      },
      status: { privacyStatus: privacy || 'public' },
    },
    media: { body: fs.createReadStream(filePath) },
  });

  return response.data;
}

// ── POST /upload — publish immediately ───────────────────────────────────────
router.post('/upload', protect, (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file provided' });

    const { title, description, tags, privacy, isShort } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const tokens = req.session?.tokens;
    if (!tokens) {
      fs.unlinkSync(req.file.path);
      return res.status(401).json({ error: 'YouTube not connected. Please connect your account first.', code: 'NOT_CONNECTED' });
    }

    try {
      const data = await uploadToYouTube({
        tokens, filePath: req.file.path, title, description,
        tags: tags ? JSON.parse(tags) : [],
        privacy: privacy || 'public',
        isShort: isShort === 'true',
      });
      fs.unlinkSync(req.file.path);
      res.json({
        success: true,
        videoId: data.id,
        url: `https://youtube.com/watch?v=${data.id}`,
        message: 'Video uploaded successfully',
      });
    } catch (e) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      const code = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
      res.status(code).json({ error: e.message, details: e.response?.data });
    }
  });
});

// ── POST /schedule — schedule for later ──────────────────────────────────────
router.post('/schedule', protect, (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file provided' });

    const { title, description, tags, privacy, isShort, scheduledAt } = req.body;
    if (!title)        return res.status(400).json({ error: 'Title is required' });
    if (!scheduledAt)  return res.status(400).json({ error: 'scheduledAt is required' });

    const tokens = req.session?.tokens;
    if (!tokens) {
      fs.unlinkSync(req.file.path);
      return res.status(401).json({ error: 'YouTube not connected.', code: 'NOT_CONNECTED' });
    }

    const userId    = req.client?._id || req.user?._id;
    const userModel = req.client ? 'Client' : 'User';

    const schedule = await YouTubeSchedule.create({
      userId, userModel, title, description,
      tags: tags ? JSON.parse(tags) : [],
      privacy: privacy || 'public',
      isShort: isShort === 'true',
      videoPath: req.file.path,
      scheduledAt: new Date(scheduledAt),
      tokens,
    });

    res.json({ success: true, scheduleId: schedule._id, scheduledAt: schedule.scheduledAt, message: 'Video scheduled successfully' });
  });
});

// ── GET /scheduled — list user's scheduled posts ─────────────────────────────
router.get('/scheduled', protect, async (req, res) => {
  const userId = req.client?._id || req.user?._id;
  const posts  = await YouTubeSchedule.find({ userId }).sort({ scheduledAt: 1 }).select('-tokens -videoPath');
  res.json({ posts });
});

// ── DELETE /scheduled/:id — cancel a scheduled post ──────────────────────────
router.delete('/scheduled/:id', protect, async (req, res) => {
  const userId = req.client?._id || req.user?._id;
  const post   = await YouTubeSchedule.findOne({ _id: req.params.id, userId });
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (post.videoPath && fs.existsSync(post.videoPath)) fs.unlinkSync(post.videoPath);
  await post.deleteOne();
  res.json({ success: true });
});

// ── GET /status — check if YouTube is connected ──────────────────────────────
router.get('/status', (req, res) => {
  res.json({ connected: !!req.session?.tokens });
});

// ── CRON: every minute — process pending scheduled posts ─────────────────────
cron.schedule('* * * * *', async () => {
  try {
    const now     = new Date();
    const pending = await YouTubeSchedule.find({ status: 'pending', scheduledAt: { $lte: now } });

    for (const post of pending) {
      try {
        if (!post.videoPath || !fs.existsSync(post.videoPath)) {
          post.status = 'failed';
          post.error  = 'Video file not found';
          await post.save();
          continue;
        }
        const data = await uploadToYouTube({
          tokens: post.tokens, filePath: post.videoPath,
          title: post.title, description: post.description,
          tags: post.tags, privacy: post.privacy, isShort: post.isShort,
        });
        if (fs.existsSync(post.videoPath)) fs.unlinkSync(post.videoPath);
        post.status     = 'published';
        post.youtubeId  = data.id;
        post.youtubeUrl = `https://youtube.com/watch?v=${data.id}`;
        post.tokens     = undefined;
        await post.save();
      } catch (e) {
        post.status = 'failed';
        post.error  = e.message;
        await post.save();
      }
    }
  } catch (_) {}
});

module.exports = router;
