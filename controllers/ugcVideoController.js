const UGCPrompter = require('../models/UGCPrompter');
const UGCVideo    = require('../models/UGCVideo');
const { putobject, getobject, deleteObject, s3Client } = require('../utils/r2');
const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const axios       = require('axios');
const FormData    = require('form-data');

const AI_BASE  = () => (process.env.UGC_AI_BASE_URL || '').replace(/\/$/, '');
const AI_TOKEN = () => process.env.UGC_AI_APP_TOKEN || '';
const aiHeaders = () => ({ 'X-App-Token': AI_TOKEN() });

// ── GET /api/ugc-prompter/public/:promptId
// User script dekhta hai — mobileuser ke liye
exports.getPromptForUser = async (req, res) => {
  try {
    const prompt = await UGCPrompter.findById(req.params.promptId)
      .select('_id title category tone duration script status createdAt')
      .lean();
    if (!prompt) return res.status(404).json({ success: false, message: 'Prompt not found' });
    if (prompt.status !== 'active') return res.status(403).json({ success: false, message: 'Prompt is not active' });
    res.json({ success: true, prompt });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/ugc-video/upload-url
// R2 presigned URL milega — Android/frontend dono ke liye
// Body: { promptId, fileName, contentType }
exports.getUploadUrl = async (req, res) => {
  try {
    const { promptId, fileName, contentType } = req.body;
    if (!promptId || !fileName) {
      return res.status(400).json({ success: false, message: 'promptId and fileName are required' });
    }

    const userId = String(req.user.id);
    const ext    = fileName.split('.').pop() || 'mp4';
    const key    = `ugc-videos/${promptId}/${userId}_${Date.now()}.${ext}`;
    const type   = contentType || 'video/mp4';

    const uploadUrl = await putobject(key, type);
    res.json({ success: true, uploadUrl, key });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/ugc-video
// Video submit karo after R2 upload — triggers AI processing pipeline
// Body: { promptId, videoKey, note, aiOptions (optional) }
exports.submitVideo = async (req, res) => {
  try {
    const { promptId, videoKey, note, aiOptions } = req.body;
    if (!promptId || !videoKey) {
      return res.status(400).json({ success: false, message: 'promptId and videoKey are required' });
    }

    const prompterDoc = await UGCPrompter.findById(promptId);
    if (!prompterDoc) {
      return res.status(404).json({ success: false, message: 'Prompter script not found' });
    }

    const userId   = String(req.user.id);
    const clientId = String(req.user.clientId || req.user.id);

    const doc = await UGCVideo.create({
      promptId, userId, clientId,
      videoKey,
      note: note || '',
      status: 'pending',
      processingStatus: 'none',
      autoApprovalSettings: prompterDoc.autoApprovalSettings || {
        recording: false, editingRequest: false, finalEditedVideo: false,
      },
    });

    // ── Kick off AI processing pipeline in background ──────────────────
    const baseUrl = AI_BASE();
    if (baseUrl) {
      (async () => {
        try {
          await UGCVideo.findByIdAndUpdate(doc._id, { processingStatus: 'uploading' });

          // Step 1: Download raw video from R2 and upload to AI server
          const r2Stream = await s3Client.send(new GetObjectCommand({
            Bucket: process.env.R2_BUCKET, Key: videoKey,
          }));
          const chunks = [];
          for await (const chunk of r2Stream.Body) chunks.push(chunk);
          const videoBuffer = Buffer.concat(chunks);

          const form = new FormData();
          form.append('file', videoBuffer, { filename: 'video.mp4', contentType: 'video/mp4' });

          const uploadRes = await axios.post(`${baseUrl}/api/ugc/upload`, form, {
            headers: { ...aiHeaders(), ...form.getHeaders() },
            maxBodyLength: Infinity,
          });
          const jobId = uploadRes.data?.job_id;
          if (!jobId) throw new Error('No job_id from AI server');

          await UGCVideo.findByIdAndUpdate(doc._id, { aiJobId: jobId, processingStatus: 'processing' });

          // Step 2: Start AI processing with options
          const processBody = {
            caption: true, subtitle_style: 'two_line_zoom_in',
            broll: true, music: true, bgm_mood: 'Motivational',
            sfx: true, zoom: true, silence: true, jumpcut: true,
            facetrack: true, viral: true, background: false, logo: false,
            video_quality: '1080p',
            ...(aiOptions || {}),
          };
          await axios.post(`${baseUrl}/api/ugc/process/${jobId}`, processBody, {
            headers: { ...aiHeaders(), 'Content-Type': 'application/json' },
          });

          // Step 3: Cron service will poll DB-based (production safe)

        } catch (err) {
          console.error('[UGC AI Pipeline]', err.message);
          await UGCVideo.findByIdAndUpdate(doc._id, { processingStatus: 'failed' });
        }
      })();
    }

    res.status(201).json({
      success: true,
      video: {
        _id:              doc._id,
        promptId:         doc.promptId,
        videoKey:         doc.videoKey,
        status:           doc.status,
        processingStatus: doc.processingStatus,
        note:             doc.note,
        createdAt:        doc.createdAt,
      },
      message: baseUrl ? 'Video submitted. AI processing started.' : 'Video submitted (AI processing not configured).',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/ugc-video/:id/status
// Frontend polling — check AI processing status for a specific video
exports.getProcessingStatus = async (req, res) => {
  try {
    const doc = await UGCVideo.findById(req.params.id)
      .select('processingStatus processingProgress aiJobId status processedVideoKey viralVideoKey')
      .lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    const result = { ...doc };
    if (doc.processedVideoKey) {
      try { result.processedVideoUrl = await getobject(doc.processedVideoKey); } catch { result.processedVideoUrl = ''; }
    }
    if (doc.viralVideoKey) {
      try { result.viralVideoUrl = await getobject(doc.viralVideoKey); } catch { result.viralVideoUrl = ''; }
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/ugc-video
// User ke apne saare submitted videos — with signed URLs
// Query: promptId (optional filter)
// Role-based: mobileuser gets own videos, client gets all videos for their prompts
exports.getUserVideos = async (req, res) => {
  try {
    const userId   = String(req.user.id);
    const clientId = String(req.user.clientId || req.user.id);
    const role     = req.user.role;

    let filter = {};

    // If mobileuser - get only their videos
    if (role === 'mobileuser') {
      filter.userId = userId;
    }
    // If client - get all videos for their prompts
    else if (role === 'client' || role === 'appclient') {
      filter.clientId = clientId;
    }

    if (req.query.promptId) filter.promptId = req.query.promptId;

    const videos = await UGCVideo.find(filter)
      .sort({ createdAt: -1 })
      .populate('promptId', 'title category script')
      .lean();

    // Refresh signed URLs
    for (const v of videos) {
      try { v.videoUrl = await getobject(v.videoKey); } catch { v.videoUrl = ''; }
      if (v.editedVideoKey) {
        try { v.editedVideoUrl = await getobject(v.editedVideoKey); } catch { v.editedVideoUrl = ''; }
      }
      if (v.processedVideoKey) {
        try { v.processedVideoUrl = await getobject(v.processedVideoKey); } catch { v.processedVideoUrl = ''; }
      }
      if (v.viralVideoKey) {
        try { v.viralVideoUrl = await getobject(v.viralVideoKey); } catch { v.viralVideoUrl = ''; }
      }
    }

    res.json({ success: true, videos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/ugc-video/:id
// Client approve/reject video
// Body: { status: 'approved' | 'rejected' }
exports.updateVideoStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'submitted', 'edited', 'approved', 'objection', 'rejected'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const role = req.user.role;

    // Only client/appclient/admin/super_admin can update status
    if (role !== 'client' && role !== 'appclient' && role !== 'admin' && role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const doc = await UGCVideo.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    if (role !== 'admin' && role !== 'super_admin') {
      const clientId = String(req.user.clientId || req.user.id);
      if (String(doc.clientId) !== clientId) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }
    }

    doc.status = status;
    await doc.save();

    await UGCPrompter.findByIdAndUpdate(doc.promptId, { status: status });

    res.json({
      success: true,
      video: {
        _id: doc._id,
        status: doc.status,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/ugc-video/:id
// User apna video delete kare
exports.deleteVideo = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const role = req.user.role;

    let filter = { _id: req.params.id };

    // mobileuser can only delete their own videos
    if (role === 'mobileuser') {
      filter.userId = userId;
    }
    // client can delete any video from their prompts
    else if (role === 'client' || role === 'appclient') {
      const clientId = String(req.user.clientId || req.user.id);
      filter.clientId = clientId;
    }

    const doc = await UGCVideo.findOne(filter);
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    // Delete from R2
    try { await deleteObject(doc.videoKey); } catch { /* ignore if already gone */ }

    await doc.deleteOne();
    res.json({ success: true, message: 'Video deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/ugc-video/:id/settings
// Update auto-approval settings
exports.updateAutoApprovalSettings = async (req, res) => {
  try {
    const { autoApprovalSettings } = req.body;
    if (!autoApprovalSettings) {
      return res.status(400).json({ success: false, message: 'autoApprovalSettings is required' });
    }

    const doc = await UGCVideo.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const clientId = String(req.user.clientId || req.user.id);
      if (String(doc.clientId) !== clientId) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }
    }

    doc.autoApprovalSettings = {
      ...doc.autoApprovalSettings,
      ...autoApprovalSettings
    };
    await doc.save();

    res.json({ success: true, autoApprovalSettings: doc.autoApprovalSettings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/ugc-video/:id/objection
// Client raises an objection
exports.submitObjection = async (req, res) => {
  try {
    const { objectionNotes } = req.body;
    if (!objectionNotes) {
      return res.status(400).json({ success: false, message: 'objectionNotes is required' });
    }

    const doc = await UGCVideo.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const clientId = String(req.user.clientId || req.user.id);
      if (String(doc.clientId) !== clientId) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }
    }

    doc.status = 'objection';
    doc.objectionNotes = objectionNotes;
    await doc.save();

    await UGCPrompter.findByIdAndUpdate(doc.promptId, { status: 'objection' });

    res.json({ success: true, status: doc.status, objectionNotes: doc.objectionNotes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/ugc-video/:id/edited
// Client/Editor uploads final edited video key
exports.submitEditedVideo = async (req, res) => {
  try {
    const { videoKey } = req.body;
    if (!videoKey) {
      return res.status(400).json({ success: false, message: 'videoKey is required' });
    }

    const doc = await UGCVideo.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      const clientId = String(req.user.clientId || req.user.id);
      if (String(doc.clientId) !== clientId) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }
    }

    doc.editedVideoKey = videoKey;
    
    // Auto approval check
    if (doc.autoApprovalSettings?.finalEditedVideo) {
      doc.status = 'approved';
    } else {
      doc.status = 'edited';
    }
    
    await doc.save();

    await UGCPrompter.findByIdAndUpdate(doc.promptId, { status: doc.status });

    res.json({ success: true, status: doc.status, editedVideoKey: doc.editedVideoKey });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
