const UGCForm = require('../models/UGCForm');
const UGCSubmission = require('../models/UGCSubmission');
const CreditWallet = require('../models/CreditWallet');
const TransactionHistory = require('../models/TransactionHistory');
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
    const userId = req.user ? String(req.user.id) : null;

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
      const userId     = String(req.user.id);
      const { campaignId, campaignTaskId } = req.body;
      if (!campaignId || !campaignTaskId || !req.file) {
        return res.status(400).json({ success: false, message: 'campaignId, campaignTaskId and video file are required' });
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

      // Upsert submission scoped to this specific task assignment
      // creditsAwarded stays false until client approves
      const submission = await UGCSubmission.findOneAndUpdate(
        { campaignTaskId, userId },
        { campaignId, campaignTaskId, videoKey: key, videoUrl, status: 'pending', videoDuration, creditsEarned, creditsAwarded: false },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Update SharedReels submissionStatus scoped to this specific task
      const SharedReels = require('../models/SharedReels');
      await SharedReels.updateOne(
        { googleId: userId, 'reels.campaignTaskId': campaignTaskId },
        { $set: { 'reels.$[elem].submissionStatus': 'pending_review', 'reels.$[elem].TaskStatus': 'in_progress' } },
        { arrayFilters: [{ 'elem.campaignTaskId': campaignTaskId }] }
      );

      const enriched = await buildUGCFormResponse(campaignId, userId);

      res.json({
        success: true,
        message: `UGC video submitted successfully. Credits will be awarded after client approval.`,
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

    const SharedReels = require('../models/SharedReels');

    if (status === 'approved') {
      // Award credits only on approval
      if (!submission.creditsAwarded && submission.creditsEarned > 0) {
        const wallet = await CreditWallet.findOneAndUpdate(
          { userId: submission.userId },
          { $inc: { totalBalance: submission.creditsEarned, acceptedCredits: submission.creditsEarned } },
          { new: true, upsert: true }
        );
        await UGCSubmission.findByIdAndUpdate(submissionId, { creditsAwarded: true });
        await TransactionHistory.create({
          userId: submission.userId,
          type: 'campaign_reward',
          amount: submission.creditsEarned,
          description: `UGC task approved: ${submission.videoDuration}s video`,
          referenceType: 'task',
          referenceId: String(submission.campaignTaskId),
          status: 'completed',
          meta: {
            campaignId: String(submission.campaignId),
            taskId: String(submission.campaignTaskId),
            reason: 'UGC submission approved by client',
          },
          balanceAfter: wallet.totalBalance,
        });
      }
      // Mark SharedReels task as completed
      await SharedReels.updateOne(
        { googleId: submission.userId, 'reels.campaignTaskId': String(submission.campaignTaskId) },
        { $set: { 'reels.$[elem].submissionStatus': 'approved', 'reels.$[elem].isTaskComplete': true, 'reels.$[elem].TaskStatus': 'completed' } },
        { arrayFilters: [{ 'elem.campaignTaskId': String(submission.campaignTaskId) }] }
      );
    } else {
      // Rejected — reset task so user can re-submit
      await SharedReels.updateOne(
        { googleId: submission.userId, 'reels.campaignTaskId': String(submission.campaignTaskId) },
        { $set: { 'reels.$[elem].submissionStatus': 'rejected', 'reels.$[elem].TaskStatus': 'accepted', 'reels.$[elem].isTaskComplete': false } },
        { arrayFilters: [{ 'elem.campaignTaskId': String(submission.campaignTaskId) }] }
      );
    }

    const data = await buildUGCFormResponse(submission.campaignId, submission.userId, String(submission.campaignTaskId));

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
    const { campaignId } = req.params;
    const userId = String(req.user.id);
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
