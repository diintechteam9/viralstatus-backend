const UGCForm = require('../models/UGCForm');
const UGCSubmission = require('../models/UGCSubmission');
const CreditWallet = require('../models/CreditWallet');
const { s3Client } = require('../utils/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getobject } = require('../utils/r2');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffprobeStatic = require('ffprobe-static');
const os = require('os');
const path = require('path');
const fs = require('fs');
const {
  buildUGCFormResponse,
  buildSubmissionPayload,
  refreshSubmissionVideoUrl,
} = require('../utils/ugcHelpers');

ffmpeg.setFfprobePath(ffprobeStatic.path);

const upload = multer({ limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB

// ── Get video duration from buffer ──────────────────────────────────────────
const getVideoDuration = (buffer, mimetype) => {
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `ugc_${Date.now()}.mp4`);
    fs.writeFileSync(tmpFile, buffer);
    ffmpeg.ffprobe(tmpFile, (err, metadata) => {
      fs.unlink(tmpFile, () => {});
      if (err) { resolve(0); return; }
      resolve(Math.floor(metadata?.format?.duration || 0));
    });
  });
};

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

// ── Get UGC Form (+ campaign, assignment, submission when userId provided) ───
exports.getUGCForm = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.params.userId || req.query.userId || null;

    const data = await buildUGCFormResponse(campaignId, userId);

    res.json({
      success: true,
      ...data,
      // backward compatible — old apps read `form` only
      form: data.form,
    });
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

      // Get video duration before uploading
      const videoDuration = await getVideoDuration(req.file.buffer, req.file.mimetype);
      const creditsEarned = videoDuration; // 1 credit per second

      const ext = req.file.originalname.split('.').pop() || 'mp4';
      const key = `ugc/${campaignId}/${userId}_${Date.now()}.${ext}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }));
      const videoUrl = await getobject(key);

      // Check if already submitted (to avoid double credits)
      const existing = await UGCSubmission.findOne({ campaignId, userId });
      const alreadyAwarded = existing?.creditsAwarded || false;

      const submission = await UGCSubmission.findOneAndUpdate(
        { campaignId, userId },
        { videoKey: key, videoUrl, status: 'pending', videoDuration, creditsEarned, creditsAwarded: true },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Add credits to wallet only if not already awarded
      if (!alreadyAwarded && creditsEarned > 0) {
        await CreditWallet.findOneAndUpdate(
          { userId },
          { $inc: { totalBalance: creditsEarned, pendingCredits: creditsEarned, totalCampaigns: 1 } },
          { upsert: true, new: true }
        );
        console.log(`[UGC Credits] userId=${userId} earned ${creditsEarned} credits for ${videoDuration}s video`);
      }

      // Update SharedReels submissionStatus to pending_review for this UGC task
      const SharedReels = require('../models/SharedReels');
      await SharedReels.updateOne(
        { googleId: userId, 'reels.campaignId': campaignId, 'reels.contentCategory': 'ugc' },
        { $set: { 'reels.$[elem].submissionStatus': 'pending_review', 'reels.$[elem].isTaskComplete': true } },
        { arrayFilters: [{ 'elem.campaignId': campaignId, 'elem.contentCategory': 'ugc' }] }
      );

      const enriched = await buildUGCFormResponse(campaignId, userId);

      res.json({
        success: true,
        message: `UGC video submitted! You earned ${creditsEarned} credits for ${videoDuration}s video.`,
        creditsEarned,
        videoDuration,
        submission: buildSubmissionPayload(submission.toObject()),
        ...enriched,
      });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
];

// ── Client: Get all UGC submissions for a campaign ───────────────────────────
exports.getUGCSubmissions = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const submissions = await UGCSubmission.find({ campaignId }).lean();
    for (const s of submissions) {
      await refreshSubmissionVideoUrl(s);
    }
    res.json({
      success: true,
      submissions: submissions.map((s) => buildSubmissionPayload(s)),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Client: Update submission status ─────────────────────────────────────────
exports.updateUGCSubmissionStatus = async (req, res) => {
  try {
    const { submissionId } = req.params;
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const submission = await UGCSubmission.findByIdAndUpdate(submissionId, { status }, { new: true });
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

    // Sync SharedReels submissionStatus
    const SharedReels = require('../models/SharedReels');
    const newSubmissionStatus = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'pending_review';
    await SharedReels.updateOne(
      { googleId: submission.userId, 'reels.campaignId': String(submission.campaignId), 'reels.contentCategory': 'ugc' },
      { $set: { 'reels.$[elem].submissionStatus': newSubmissionStatus } },
      { arrayFilters: [{ 'elem.campaignId': String(submission.campaignId), 'elem.contentCategory': 'ugc' }] }
    );

    const data = await buildUGCFormResponse(submission.campaignId, submission.userId);

    res.json({
      success: true,
      submission: buildSubmissionPayload(submission.toObject()),
      ...data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── User: Get their own UGC submission for a campaign ────────────────────────
exports.getUserUGCSubmission = async (req, res) => {
  try {
    const { campaignId, userId } = req.params;
    const data = await buildUGCFormResponse(campaignId, userId);

    res.json({
      success: true,
      submission: data.submission,
      form: data.form,
      campaign: data.campaign,
      assignment: data.assignment,
      creditsOnCompletion: data.creditsOnCompletion,
      expiresAt: data.expiresAt,
      expiresAtFormatted: data.expiresAtFormatted,
      assignedAt: data.assignedAt,
      assignedAtFormatted: data.assignedAtFormatted,
      hasSubmitted: data.hasSubmitted,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
