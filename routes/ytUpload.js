const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const router = express.Router();
const YouTubeSchedule = require('../models/YouTubeSchedule');
const Account = require('../models/Account');
const { protect } = require('../middleware/auth');

// ── Ensure uploads directory exists ──────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Multer setup ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => cb(null, `yt-${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    file.mimetype.startsWith('video/')
      ? cb(null, true)
      : cb(new Error('Only video files are allowed'), false);
  },
  limits: { fileSize: 256 * 1024 * 1024 }, // 256 MB
});

// ── Helper: get userId from req (works for both Client and User) ──────────────
// auth.js sets req.user = { id, email } and req.client = { id, email }
// Always use .id — never ._ id (that field doesn't exist on the plain object)
function getUserId(req) {
  const id = (req.client?.id || req.user?.id || '').toString();
  console.log('[YT] getUserId:', id, '| client:', req.client?.id, '| user:', req.user?.id);
  return id;
}

// ── Helper: safe file delete ──────────────────────────────────────────────────
function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.error('[YT] safeUnlink error:', e.message);
  }
}

// ── Helper: build OAuth2 client with auto token refresh ──────────────────────
function buildOAuth2Client(tokens) {
  const auth = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.REDIRECT_URI || `${process.env.BACKEND_URL}/auth/youtube/callback`
  );
  auth.setCredentials(tokens);

  // Persist refreshed tokens back to DB automatically
  auth.on('tokens', async (newTokens) => {
    try {
      const merged = { ...tokens, ...newTokens };
      await Account.findOneAndUpdate(
        { youtubeTokens: { $exists: true }, 'youtubeTokens.refresh_token': tokens.refresh_token },
        { youtubeTokens: merged, updatedAt: new Date() }
      );
      console.log('[YT] Tokens auto-refreshed and saved to DB');
    } catch (e) {
      console.error('[YT] Failed to persist refreshed tokens:', e.message);
    }
  });

  return auth;
}

// ── Helper: upload video to YouTube ──────────────────────────────────────────
async function uploadToYouTube({ tokens, filePath, title, description, tags, privacy, isShort }) {
  const auth = buildOAuth2Client(tokens);
  const youtube = google.youtube({ version: 'v3', auth });

  const finalTitle = isShort ? `${title} #Shorts` : title;

  // Fetch channel info alongside upload
  const [uploadRes, channelRes] = await Promise.allSettled([
    youtube.videos.insert({
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
    }),
    youtube.channels.list({ part: 'snippet', mine: true }),
  ]);

  if (uploadRes.status === 'rejected') throw uploadRes.reason;

  const channel = channelRes.status === 'fulfilled'
    ? channelRes.value.data.items?.[0]
    : null;

  return {
    ...uploadRes.value.data,
    channelName: channel?.snippet?.title || '',
    channelId:   channel?.id || '',
  };
}

// ── POST /api/youtube/upload — publish immediately ────────────────────────────
router.post('/upload', protect, (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file provided' });

    const { title, description, tags, privacy, isShort } = req.body;
    if (!title) {
      safeUnlink(req.file.path);
      return res.status(400).json({ error: 'Title is required' });
    }

    const userId = getUserId(req);
    if (!userId) {
      safeUnlink(req.file.path);
      return res.status(401).json({ error: 'User identity could not be determined', code: 'AUTH_ERROR' });
    }

    let account;
    try {
      account = await Account.findOne({ userId });
      console.log('[YT] Upload - userId:', userId, '| account found:', !!account, '| hasTokens:', !!account?.youtubeTokens);
    } catch (dbErr) {
      safeUnlink(req.file.path);
      console.error('[YT] DB error finding account:', dbErr.message);
      return res.status(500).json({ error: 'Database error. Please try again.' });
    }

    const tokens = account?.youtubeTokens;
    if (!tokens) {
      safeUnlink(req.file.path);
      return res.status(401).json({
        error: 'YouTube not connected. Please connect your account first.',
        code: 'NOT_CONNECTED',
      });
    }

    try {
      const data = await uploadToYouTube({
        tokens,
        filePath: req.file.path,
        title,
        description,
        tags: tags ? JSON.parse(tags) : [],
        privacy: privacy || 'public',
        isShort: isShort === 'true',
      });
      safeUnlink(req.file.path);
      console.log(`[YT] Video uploaded successfully: ${data.id} by userId: ${userId} on channel: ${data.channelName}`);
      return res.json({
        success: true,
        videoId: data.id,
        url: `https://youtube.com/watch?v=${data.id}`,
        channelName: data.channelName,
        channelId: data.channelId,
        message: `Video uploaded successfully to ${data.channelName || 'YouTube'}`,
      });
    } catch (e) {
      safeUnlink(req.file.path);
      console.error('[YT] Upload error:', e.message);

      // Handle token revoked / expired
      if (e.code === 401 || e.message?.includes('invalid_grant') || e.message?.includes('Token has been expired')) {
        await Account.findOneAndUpdate({ userId }, { youtubeTokens: null });
        return res.status(401).json({ error: 'YouTube session expired. Please reconnect your account.', code: 'NOT_CONNECTED' });
      }
      if (e.code === 403) {
        return res.status(403).json({ error: 'YouTube API quota exceeded or permission denied.', details: e.response?.data });
      }
      return res.status(500).json({ error: e.message || 'Upload failed. Please try again.', details: e.response?.data });
    }
  });
});

// ── POST /api/youtube/schedule — schedule for later ──────────────────────────
router.post('/schedule', protect, (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file provided' });

    const { title, description, tags, privacy, isShort, scheduledAt } = req.body;
    if (!title) {
      safeUnlink(req.file.path);
      return res.status(400).json({ error: 'Title is required' });
    }
    if (!scheduledAt) {
      safeUnlink(req.file.path);
      return res.status(400).json({ error: 'scheduledAt is required' });
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      safeUnlink(req.file.path);
      return res.status(400).json({ error: 'scheduledAt must be a valid future date' });
    }

    const userId = getUserId(req);
    if (!userId) {
      safeUnlink(req.file.path);
      return res.status(401).json({ error: 'User identity could not be determined', code: 'AUTH_ERROR' });
    }

    let account;
    try {
      account = await Account.findOne({ userId });
    } catch (dbErr) {
      safeUnlink(req.file.path);
      console.error('[YT] DB error finding account:', dbErr.message);
      return res.status(500).json({ error: 'Database error. Please try again.' });
    }

    const tokens = account?.youtubeTokens;
    if (!tokens) {
      safeUnlink(req.file.path);
      return res.status(401).json({ error: 'YouTube not connected.', code: 'NOT_CONNECTED' });
    }

    try {
      const userModel = req.client ? 'Client' : 'User';
      const schedule = await YouTubeSchedule.create({
        userId,
        userModel,
        title,
        description: description || '',
        tags: tags ? JSON.parse(tags) : [],
        privacy: privacy || 'public',
        isShort: isShort === 'true',
        videoPath: req.file.path,
        scheduledAt: scheduledDate,
        tokens,
      });
      console.log(`[YT] Video scheduled: ${schedule._id} for ${scheduledDate.toISOString()} by userId: ${userId}`);
      return res.json({
        success: true,
        scheduleId: schedule._id,
        scheduledAt: schedule.scheduledAt,
        message: 'Video scheduled successfully',
      });
    } catch (e) {
      safeUnlink(req.file.path);
      console.error('[YT] Schedule create error:', e.message);
      return res.status(500).json({ error: 'Failed to schedule video. Please try again.' });
    }
  });
});

// ── GET /api/youtube/scheduled — list user's scheduled posts ─────────────────
router.get('/scheduled', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const posts = await YouTubeSchedule
      .find({ userId })
      .sort({ scheduledAt: 1 })
      .select('-tokens -videoPath');
    return res.json({ posts });
  } catch (e) {
    console.error('[YT] Fetch scheduled error:', e.message);
    return res.status(500).json({ error: 'Failed to fetch scheduled posts' });
  }
});

// ── DELETE /api/youtube/scheduled/:id — cancel a scheduled post ───────────────
router.delete('/scheduled/:id', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const post = await YouTubeSchedule.findOne({ _id: req.params.id, userId });
    if (!post) return res.status(404).json({ error: 'Scheduled post not found' });
    if (post.status !== 'pending') {
      return res.status(400).json({ error: `Cannot delete a post with status: ${post.status}` });
    }
    safeUnlink(post.videoPath);
    await post.deleteOne();
    console.log(`[YT] Scheduled post deleted: ${req.params.id} by userId: ${userId}`);
    return res.json({ success: true });
  } catch (e) {
    console.error('[YT] Delete scheduled error:', e.message);
    return res.status(500).json({ error: 'Failed to delete scheduled post' });
  }
});

// ── GET /api/youtube/status — check if YouTube is connected ──────────────────
router.get('/status', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const account = await Account.findOne({ userId });
    return res.json({ connected: !!account?.youtubeTokens });
  } catch (e) {
    console.error('[YT] Status check error:', e.message);
    return res.status(500).json({ connected: false, error: 'Status check failed' });
  }
});

// ── GET /api/youtube/disconnect — disconnect YouTube account ──────────────────
// Also handled via POST for backward compatibility
router.post('/disconnect', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const account = await Account.findOne({ userId });
    const tokens = account?.youtubeTokens;

    if (tokens?.access_token) {
      try {
        const auth = buildOAuth2Client(tokens);
        await auth.revokeCredentials();
        console.log(`[YT] Tokens revoked for userId: ${userId}`);
      } catch (_) {
        // Revoke failure is non-fatal — still clear from DB
        console.warn('[YT] Token revoke failed (non-fatal), clearing from DB anyway');
      }
    }

    await Account.findOneAndUpdate({ userId }, { youtubeTokens: null, updatedAt: new Date() });
    console.log(`[YT] YouTube disconnected for userId: ${userId}`);
    return res.json({ success: true, message: 'Successfully disconnected from YouTube' });
  } catch (e) {
    console.error('[YT] Disconnect error:', e.message);
    return res.status(500).json({ error: 'Failed to disconnect from YouTube' });
  }
});

// ── CRON: every minute — process pending scheduled posts ─────────────────────
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    const pending = await YouTubeSchedule.find({
      status: 'pending',
      scheduledAt: { $lte: now },
    });

    if (pending.length > 0) {
      console.log(`[YT CRON] Processing ${pending.length} pending post(s)`);
    }

    for (const post of pending) {
      try {
        if (!post.videoPath || !fs.existsSync(post.videoPath)) {
          post.status = 'failed';
          post.error  = 'Video file not found on server';
          await post.save();
          console.error(`[YT CRON] Video file missing for schedule: ${post._id}`);
          continue;
        }

        const data = await uploadToYouTube({
          tokens:      post.tokens,
          filePath:    post.videoPath,
          title:       post.title,
          description: post.description,
          tags:        post.tags,
          privacy:     post.privacy,
          isShort:     post.isShort,
        });

        safeUnlink(post.videoPath);
        post.status     = 'published';
        post.youtubeId  = data.id;
        post.youtubeUrl = `https://youtube.com/watch?v=${data.id}`;
        post.tokens     = undefined; // clear tokens after use
        await post.save();
        console.log(`[YT CRON] Published: ${post._id} → https://youtube.com/watch?v=${data.id}`);
      } catch (e) {
        post.status = 'failed';
        post.error  = e.message;
        await post.save();
        console.error(`[YT CRON] Failed to publish ${post._id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[YT CRON] Cron job error:', e.message);
  }
});

module.exports = router;
