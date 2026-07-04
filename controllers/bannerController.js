const Banner    = require('../models/Banner');
const multer    = require('multer');
const { s3Client }  = require('../utils/r2');
const { getobject } = require('../utils/r2');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function refreshUrl(b) {
  if (b?.imageKey) {
    try { b.imageUrl = await getobject(b.imageKey); } catch {}
  }
  return b;
}

// ── GET /api/banners?clientId=&admin=true ───────────────────────────────────
exports.getBanners = async (req, res) => {
  try {
    const { clientId, admin } = req.query;
    const filter = {};
    if (!admin) filter.isActive = true;          // public: only active
    if (clientId) filter.clientId = clientId;

    const banners = await Banner.find(filter).sort({ order: 1, createdAt: -1 }).lean();
    await Promise.all(banners.map(refreshUrl));
    res.json({ success: true, banners });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/banners — client creates banner ────────────────────────────────
exports.createBanner = [
  upload.single('image'),
  async (req, res) => {
    try {
      const { clientId, title, description } = req.body;
      if (!title?.trim()) {
        return res.status(400).json({ success: false, message: 'title required' });
      }
      const cId = clientId || req.user?.clientId || req.user?.id?.toString() || 'admin';

      let imageKey = '', imageUrl = '';
      if (req.file) {
        const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
        imageKey = `banners/${cId}/${Date.now()}.${ext}`;
        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: imageKey, Body: req.file.buffer, ContentType: req.file.mimetype,
        }));
        imageUrl = await getobject(imageKey);
      }

      const banner = await Banner.create({
        clientId: cId, title: title.trim(), description: description || '',
        imageKey, imageUrl, order: 0, isActive: true,
      });
      res.status(201).json({ success: true, banner });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
];

// ── PATCH /api/banners/:id — update banner ───────────────────────────────────
exports.updateBanner = [
  upload.single('image'),
  async (req, res) => {
    try {
      const b = await Banner.findById(req.params.id);
      if (!b) return res.status(404).json({ success: false, message: 'Not found' });

      if (req.body.title       !== undefined) b.title       = req.body.title.trim();
      if (req.body.description !== undefined) b.description = req.body.description;
      if (req.body.order       !== undefined) b.order       = Number(req.body.order);
      if (req.body.isActive !== undefined) b.isActive = req.body.isActive !== 'false';

      if (req.file) {
        if (b.imageKey) {
          try { await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: b.imageKey })); } catch {}
        }
        const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
        b.imageKey = `banners/${b.clientId || 'admin'}/${Date.now()}.${ext}`;
        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET, Key: b.imageKey,
          Body: req.file.buffer, ContentType: req.file.mimetype,
        }));
        b.imageUrl = await getobject(b.imageKey);
      }

      await b.save();
      res.json({ success: true, banner: b.toObject() });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
];

// ── DELETE /api/banners/:id ──────────────────────────────────────────────────
exports.deleteBanner = async (req, res) => {
  try {
    const b = await Banner.findByIdAndDelete(req.params.id);
    if (!b) return res.status(404).json({ success: false, message: 'Not found' });
    if (b.imageKey) {
      try { await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: b.imageKey })); } catch {}
    }
    res.json({ success: true, message: 'Banner deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
