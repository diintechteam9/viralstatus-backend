const UGCForm = require('../models/UGCForm');
const UGCSubmission = require('../models/UGCSubmission');
const { putobject, getobject } = require('../utils/r2');
const { s3Client } = require('../utils/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');

const upload = multer({ limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB

// ── Client: Save/Update UGC Form for a campaign ──────────────────────────────
exports.saveUGCForm = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { title, instructions, script, referenceVideoUrl } = req.body;
    if (!title || !instructions) {
      return res.status(400).json({ success: false, message: 'Title and instructions are required' });
    }
    const form = await UGCForm.findOneAndUpdate(
      { campaignId },
      { title, instructions, script: script || '', referenceVideoUrl: referenceVideoUrl || '' },
      { upsert: true, new: true }
    );
    res.json({ success: true, form });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get UGC Form for a campaign ───────────────────────────────────────────────
exports.getUGCForm = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const form = await UGCForm.findOne({ campaignId }).lean();
    res.json({ success: true, form: form || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── User: Upload UGC video (multipart) ───────────────────────────────────────
exports.uploadUGCVideo = [
  upload.single('video'),
  async (req, res) => {
    try {
      const { campaignId, userId } = req.body;
      if (!campaignId || !userId || !req.file) {
        return res.status(400).json({ success: false, message: 'campaignId, userId and video file are required' });
      }
      const ext = req.file.originalname.split('.').pop() || 'mp4';
      const key = `ugc/${campaignId}/${userId}_${Date.now()}.${ext}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }));
      const videoUrl = await getobject(key);
      const submission = await UGCSubmission.findOneAndUpdate(
        { campaignId, userId },
        { videoKey: key, videoUrl, status: 'pending' },
        { upsert: true, new: true }
      );
      res.json({ success: true, submission });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
];

// ── Client: Get all UGC submissions for a campaign ───────────────────────────
exports.getUGCSubmissions = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const submissions = await UGCSubmission.find({ campaignId }).lean();
    // Refresh presigned URLs
    for (const s of submissions) {
      if (s.videoKey) {
        try { s.videoUrl = await getobject(s.videoKey); } catch {}
      }
    }
    res.json({ success: true, submissions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Client: Update submission status ─────────────────────────────────────────
exports.updateUGCSubmissionStatus = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { status } = req.body; // approved | rejected
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const submission = await UGCSubmission.findByIdAndUpdate(submissionId, { status }, { new: true });
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });
    res.json({ success: true, submission });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── User: Get their own UGC submission for a campaign ────────────────────────
exports.getUserUGCSubmission = async (req, res) => {
  try {
    const { campaignId, userId } = req.params;
    const submission = await UGCSubmission.findOne({ campaignId, userId }).lean();
    if (submission?.videoKey) {
      try { submission.videoUrl = await getobject(submission.videoKey); } catch {}
    }
    res.json({ success: true, submission: submission || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
