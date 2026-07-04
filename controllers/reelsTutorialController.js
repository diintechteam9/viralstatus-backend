const multer        = require('multer');
const ReelsTutorial = require('../models/ReelsTutorial');
const { s3Client }  = require('../utils/r2');
const { getobject } = require('../utils/r2');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// ── Refresh a single tutorial's videoUrl from R2 ─────────────────────────────
async function refreshVideoUrl(t) {
  if (!t?.videoKey) return t;
  try { t.videoUrl = await getobject(t.videoKey); } catch { /* keep stored */ }
  return t;
}

// ── GET /api/reels-tutorials ─────────────────────────────────────────────────
exports.listTutorials = async (req, res) => {
  try {
    const { clientId } = req.query;
    const filter = { isActive: true };
    if (clientId) filter.clientId = clientId;

    const tutorials = await ReelsTutorial.find(filter).sort({ createdAt: -1 }).lean();
    await Promise.all(tutorials.map(refreshVideoUrl));
    res.json({ success: true, tutorials });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/reels-tutorials/:id ─────────────────────────────────────────────
exports.getTutorial = async (req, res) => {
  try {
    const t = await ReelsTutorial.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ success: false, message: 'Not found' });
    await refreshVideoUrl(t);
    res.json({ success: true, tutorial: t });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/reels-tutorials ─────────────────────────────────────────────────
// Accepts multipart/form-data with optional `video` file
exports.createTutorial = [
  upload.single('video'),
  async (req, res) => {
    try {
      const { clientId, title, description } = req.body;
      if (!clientId || !title?.trim())
        return res.status(400).json({ success: false, message: 'clientId and title are required' });

      let videoKey = '';
      let videoUrl = '';

      if (req.file) {
        const ext = (req.file.originalname.split('.').pop() || 'mp4').toLowerCase();
        videoKey = `tutorials/${clientId}/${Date.now()}.${ext}`;
        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key:    videoKey,
          Body:   req.file.buffer,
          ContentType: req.file.mimetype,
        }));
        videoUrl = await getobject(videoKey);
      }

      const tutorial = await ReelsTutorial.create({
        clientId,
        title:       title.trim(),
        description: description || '',
        videoKey,
        videoUrl,
        isActive:    true,
      });

      res.status(201).json({ success: true, tutorial });
    } catch (err) {
      console.error('[ReelsTutorial] create error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
];

// ── PATCH /api/reels-tutorials/:id ───────────────────────────────────────────
// Supports replacing video file or updating text fields only
exports.updateTutorial = [
  upload.single('video'),
  async (req, res) => {
    try {
      const existing = await ReelsTutorial.findById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Tutorial not found' });

      if (req.body.title !== undefined) existing.title       = req.body.title.trim();
      if (req.body.description !== undefined) existing.description = req.body.description;
      if (req.body.isActive !== undefined) existing.isActive = req.body.isActive !== 'false';

      if (req.file) {
        // Delete old video from R2
        if (existing.videoKey) {
          try { await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: existing.videoKey })); } catch {}
        }
        const ext = (req.file.originalname.split('.').pop() || 'mp4').toLowerCase();
        existing.videoKey = `tutorials/${existing.clientId}/${Date.now()}.${ext}`;
        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key:    existing.videoKey,
          Body:   req.file.buffer,
          ContentType: req.file.mimetype,
        }));
        existing.videoUrl = await getobject(existing.videoKey);
      }

      await existing.save();
      res.json({ success: true, tutorial: existing.toObject() });
    } catch (err) {
      console.error('[ReelsTutorial] update error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
];

// ── DELETE /api/reels-tutorials/:id ──────────────────────────────────────────
exports.deleteTutorial = async (req, res) => {
  try {
    const t = await ReelsTutorial.findByIdAndDelete(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: 'Tutorial not found' });
    if (t.videoKey) {
      try { await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: t.videoKey })); } catch {}
    }
    res.json({ success: true, message: 'Tutorial deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
