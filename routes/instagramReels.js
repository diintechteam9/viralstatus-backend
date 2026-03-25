const express = require('express');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const { spawnSync, spawn } = require('child_process');
const ffprobePath = require('ffprobe-static').path;
const ffmpegPath = require('ffmpeg-static');
const InstagramAccount = require('../models/InstagramAccount');
const { protect } = require('../middleware/auth');
const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'reels');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function getUserId(req) {
  return (req.client?.id || req.user?.id || '').toString();
}

function safeUnlink(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename:    (req, file, cb) => cb(null, `ig-${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    ['video/mp4', 'video/quicktime'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only MP4 and MOV files are allowed'));
  },
});

// ── Video validation ──────────────────────────────────────────────────────────
function validateVideo(filePath) {
  return new Promise((resolve) => {
    const result = spawnSync(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath
    ], { encoding: 'utf-8', timeout: 20000 });

    if (result.error || result.status !== 0) return resolve(false);
    try {
      const info = JSON.parse(result.stdout);
      const fmt = info.format.format_name;
      if (!fmt.includes('mov') && !fmt.includes('mp4')) return resolve(false);
      if (parseInt(info.format.size) > 100 * 1024 * 1024) return resolve(false);

      const v = info.streams.find(s => s.codec_type === 'video');
      if (!v || v.codec_name !== 'h264') return resolve(false);
      if (v.width > 1080 || v.height > 1920) return resolve(false);

      const [n, d] = (v.avg_frame_rate || '30/1').split('/').map(Number);
      const fps = n / d;
      if (fps < 23 || fps > 60) return resolve(false);

      const aspect = v.width / v.height;
      if (Math.abs(aspect - 9 / 16) > 0.02) return resolve(false);

      const a = info.streams.find(s => s.codec_type === 'audio');
      if (!a || a.codec_name !== 'aac') return resolve(false);

      resolve(true);
    } catch (_) { resolve(false); }
  });
}

function convertVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, [
      '-i', inputPath,
      '-ss', '00:00:00', '-t', '00:03:00',
      '-c:v', 'libx264', '-preset', 'ultrafast',
      '-c:a', 'aac', '-b:a', '128k',
      '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2',
      '-r', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-y', outputPath,
    ]);
    let err = '';
    ffmpeg.stderr.on('data', d => { err += d.toString(); });
    ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg conversion failed')));
    ffmpeg.on('error', reject);
  });
}

// ── POST /api/instagram/reels/upload ─────────────────────────────────────────
router.post('/upload', protect, (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file provided' });

    const userId = getUserId(req);
    if (!userId) {
      safeUnlink(req.file.path);
      return res.status(401).json({ error: 'Not authenticated', code: 'AUTH_ERROR' });
    }

    const { caption } = req.body;
    let convertedPath = null;

    try {
      const account = await InstagramAccount.findOne({ userId });
      if (!account) {
        safeUnlink(req.file.path);
        return res.status(404).json({ error: 'Instagram not connected. Please connect your account first.', code: 'NOT_CONNECTED' });
      }

      // Validate & convert if needed
      const isValid = await validateVideo(req.file.path).catch(() => false);
      let videoPath = req.file.path;
      if (!isValid) {
        convertedPath = path.join(UPLOADS_DIR, `${Date.now()}-converted.mp4`);
        await convertVideo(req.file.path, convertedPath);
        videoPath = convertedPath;
      }

      const videoFileName = path.basename(videoPath);
      const videoUrl = `${process.env.BACKEND_URL}/api/instagram/reels/stream/${videoFileName}`;
      console.log(`[IG Upload] Video URL: ${videoUrl}`);

      // 1. Create media container
      const containerRes = await axios.post(
        `https://graph.facebook.com/v21.0/${account.instagramId}/media`,
        {
          media_type:    'REELS',
          video_url:     videoUrl,
          caption:       caption || '',
          share_to_feed: 'true',
          access_token:  account.accessToken,
        }
      );
      const containerId = containerRes.data?.id;
      if (!containerId) throw new Error('Failed to create media container');

      // 2. Poll status
      let status;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const statusRes = await axios.get(`https://graph.facebook.com/v21.0/${containerId}`, {
          params: { fields: 'status_code,status', access_token: account.accessToken },
        });
        status = statusRes.data;
        console.log(`[IG Upload] Status check ${i + 1}:`, status.status_code);
        if (status.status_code === 'FINISHED') break;
        if (status.status_code === 'ERROR') throw new Error('Instagram media processing failed');
      }
      if (status?.status_code !== 'FINISHED') throw new Error('Media processing timed out');

      // 3. Publish
      const publishRes = await axios.post(
        `https://graph.facebook.com/v21.0/${account.instagramId}/media_publish`,
        { creation_id: containerId, access_token: account.accessToken }
      );
      if (!publishRes.data?.id) throw new Error('Failed to publish reel');

      // Cleanup after 5 min
      setTimeout(() => {
        safeUnlink(req.file.path);
        if (convertedPath) safeUnlink(convertedPath);
      }, 5 * 60 * 1000);

      console.log(`[IG Upload] Published reel: ${publishRes.data.id} by userId: ${userId}`);
      return res.json({
        success:  true,
        id:       publishRes.data.id,
        url:      `https://www.instagram.com/reel/${publishRes.data.id}`,
        message:  `Reel uploaded to @${account.username}`,
        username: account.username,
      });

    } catch (e) {
      safeUnlink(req.file.path);
      if (convertedPath) safeUnlink(convertedPath);
      console.error('[IG Upload] Error:', e.message);
      return res.status(500).json({ error: e.message || 'Upload failed' });
    }
  });
});

// ── GET /api/instagram/reels/stream/:filename ─────────────────────────────────
router.get('/stream/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  const stat = fs.statSync(filePath);
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size });
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
