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
// Returns prompt details + all video submissions for this prompt with complete data
exports.getPromptForUser = async (req, res) => {
  try {
    const prompt = await UGCPrompter.findById(req.params.promptId)
      .select('_id title category tone duration script status createdAt platform brandName productName keyPoints')
      .lean();
    if (!prompt) return res.status(404).json({ success: false, message: 'Prompt not found' });

    // Get all videos submitted for this prompt with complete details
    const videos = await UGCVideo.find({ promptId: req.params.promptId })
      .sort({ createdAt: -1 })
      .lean();

    // Generate signed URLs for all video keys
    for (const v of videos) {
      v.id = v._id.toString();
      if (v.videoKey) {
        try { v.videoUrl = await getobject(v.videoKey); } catch { v.videoUrl = ''; }
      }
      if (v.editedVideoKey && v.editedVideoKey.trim()) {
        try { v.editedVideoUrl = await getobject(v.editedVideoKey.trim()); } catch { v.editedVideoUrl = ''; }
      } else {
        v.editedVideoUrl = '';
      }
      if (v.processedVideoKey && v.processedVideoKey.trim()) {
        try { v.processedVideoUrl = await getobject(v.processedVideoKey.trim()); } catch { v.processedVideoUrl = ''; }
      } else { v.processedVideoUrl = ''; }
      if (v.viralVideoKey && v.viralVideoKey.trim()) {
        try { v.viralVideoUrl = await getobject(v.viralVideoKey.trim()); } catch { v.viralVideoUrl = ''; }
      } else { v.viralVideoUrl = ''; }
    }

    res.json({ success: true, prompt, videos });
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
// Video submit karo after R2 upload
// Body: { promptId, videoKey, note }
// IMPORTANT: NO automatic AI processing - user decides via request-edit endpoint
exports.submitVideo = async (req, res) => {
  try {
    const { promptId, videoKey, note } = req.body;
    if (!promptId || !videoKey) {
      return res.status(400).json({ success: false, message: 'promptId and videoKey are required' });
    }

    const prompterDoc = await UGCPrompter.findById(promptId);
    if (!prompterDoc) {
      return res.status(404).json({ success: false, message: 'Prompter script not found' });
    }

    // Allow video submission for all active script statuses except archived
    const blockedStatuses = ['archived'];
    if (blockedStatuses.includes(prompterDoc.status)) {
      return res.status(403).json({ 
        success: false, 
        message: `Cannot submit video for archived script.` 
      });
    }

    const userId   = String(req.user.id);
    const clientId = String(req.user.clientId || prompterDoc.clientId || req.user.id);

    // Video starts in 'client_review' status - client must approve before AI processing
    const initialStatus = 'client_review';

    const doc = await UGCVideo.create({
      promptId, userId, clientId,
      videoKey,
      note: note || '',
      status: initialStatus,
      processingStatus: 'none',
      autoApprovalSettings: prompterDoc.autoApprovalSettings || {
        recording: false, editingRequest: false, finalEditedVideo: false,
      },
    });

    // Update prompter status to match video
    await UGCPrompter.findByIdAndUpdate(promptId, { status: initialStatus });

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
      message: 'Video submitted successfully. Waiting for client approval.',
    });
  } catch (err) {
    console.error('[UGC Submit] Error:', err.message);
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

    if (role === 'mobileuser') {
      filter.userId = userId;
    } else if (role === 'client' || role === 'appclient') {
      filter.clientId = clientId;
    }

    if (req.query.promptId) filter.promptId = req.query.promptId;
    if (req.query.clientId && (role === 'admin' || role === 'super_admin')) {
      filter.clientId = req.query.clientId;
    }

    const videos = await UGCVideo.find(filter)
      .sort({ createdAt: -1 })
      .populate('promptId', '_id title category script platform tone duration brandName productName keyPoints status')
      .lean();

    // Generate fresh signed URLs for all video keys
    for (const v of videos) {
      v.id = v._id.toString();
      if (v.videoKey) {
        try { v.videoUrl = await getobject(v.videoKey); } catch { v.videoUrl = ''; }
      }
      if (v.editedVideoKey && v.editedVideoKey.trim()) {
        try { v.editedVideoUrl = await getobject(v.editedVideoKey.trim()); } catch (e) {
          console.error('[getUserVideos] editedVideoUrl sign error:', e.message);
          v.editedVideoUrl = '';
        }
      } else {
        v.editedVideoUrl = '';
      }
      if (v.processedVideoKey && v.processedVideoKey.trim()) {
        try { v.processedVideoUrl = await getobject(v.processedVideoKey.trim()); } catch { v.processedVideoUrl = ''; }
      } else { v.processedVideoUrl = ''; }
      if (v.viralVideoKey && v.viralVideoKey.trim()) {
        try { v.viralVideoUrl = await getobject(v.viralVideoKey.trim()); } catch { v.viralVideoUrl = ''; }
      } else { v.viralVideoUrl = ''; }
    }

    res.json({ success: true, videos });
  } catch (err) {
    console.error('[getUserVideos] Error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/ugc-video/:id
// Client approve/reject raw video from client_review status
// Body: { status: 'approved' | 'rejected', rejectionReason?: string }
exports.updateVideoStatus = async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    const validStatuses = ['approved', 'rejected'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const role = req.user.role;

    if (role !== 'client' && role !== 'appclient' && role !== 'admin' && role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const doc = await UGCVideo.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    if (role !== 'admin' && role !== 'super_admin') {
      const clientId = String(req.user.clientId || req.user.id);
      if (String(doc.clientId) !== clientId && String(doc.clientId) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }
    }

    // Only allow approve/reject from client_review status
    if (doc.status !== 'client_review') {
      return res.status(400).json({ success: false, message: `Cannot approve/reject video with status: ${doc.status}. Video must be in 'client_review' status.` });
    }

    doc.status = status;
    if (status === 'rejected' && rejectionReason) {
      doc.objectionNotes = rejectionReason;
    }
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

    if (role === 'mobileuser') {
      filter.userId = userId;
    }
    else if (role === 'client' || role === 'appclient') {
      const clientId = String(req.user.clientId || req.user.id);
      filter.clientId = clientId;
    }

    const doc = await UGCVideo.findOne(filter);
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    try { await deleteObject(doc.videoKey); } catch { }

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
      if (String(doc.clientId) !== clientId && String(doc.clientId) !== String(req.user.id)) {
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
      if (String(doc.clientId) !== clientId && String(doc.clientId) !== String(req.user.id)) {
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

// ── POST /api/ugc-video/:id/request-edit
// MobileUser requests editing for their approved video
// THIS NOW TRIGGERS AI PROCESSING PIPELINE
exports.requestEdit = async (req, res) => {
  try {
    const doc = await UGCVideo.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    if (req.user.role === 'mobileuser' && String(doc.userId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Only allow edit request from approved status
    if (doc.status !== 'approved') {
      return res.status(400).json({ success: false, message: `Cannot request edit for video with status: ${doc.status}. Video must be approved by client first.` });
    }

    // Auto-approve editing request if setting enabled
    const newStatus = doc.autoApprovalSettings?.editingRequest ? 'editing' : 'editing_requested';
    doc.status = newStatus;
    await doc.save();

    await UGCPrompter.findByIdAndUpdate(doc.promptId, { status: newStatus });

    // ── NOW START AI PROCESSING PIPELINE ──────────────────────────────────
    const baseUrl = AI_BASE();
    if (baseUrl && AI_TOKEN()) {
      (async () => {
        try {
          await UGCVideo.findByIdAndUpdate(doc._id, { processingStatus: 'uploading' });

          let videoBuffer;
          let retries = 3;
          while (retries > 0) {
            try {
              const r2Stream = await s3Client.send(new GetObjectCommand({
                Bucket: process.env.R2_BUCKET, 
                Key: doc.videoKey,
              }));
              const chunks = [];
              for await (const chunk of r2Stream.Body) chunks.push(chunk);
              videoBuffer = Buffer.concat(chunks);
              break;
            } catch (err) {
              retries--;
              if (retries === 0) throw new Error(`Failed to download from R2 after 3 retries: ${err.message}`);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }

          if (!videoBuffer || videoBuffer.length === 0) {
            throw new Error('Downloaded video buffer is empty');
          }

          const form = new FormData();
          form.append('file', videoBuffer, { filename: 'video.mp4', contentType: 'video/mp4' });

          const uploadRes = await axios.post(`${baseUrl}/api/ugc/upload`, form, {
            headers: { ...aiHeaders(), ...form.getHeaders() },
            maxBodyLength: Infinity,
            timeout: 120000,
          });
          const jobId = uploadRes.data?.job_id;
          if (!jobId) throw new Error('No job_id from AI server');

          await UGCVideo.findByIdAndUpdate(doc._id, { aiJobId: jobId, processingStatus: 'processing' });

          const processBody = {
            caption: true, subtitle_style: 'two_line_zoom_in',
            broll: true, music: true, bgm_mood: 'Motivational',
            sfx: true, zoom: true, silence: true, jumpcut: true,
            facetrack: true, viral: true, background: false, logo: false,
            video_quality: '1080p',
          };
          await axios.post(`${baseUrl}/api/ugc/process/${jobId}`, processBody, {
            headers: { ...aiHeaders(), 'Content-Type': 'application/json' },
            timeout: 30000,
          });

          console.log(`[UGC Edit Request] ✅ Video ${doc._id} queued for AI processing with job ${jobId}`);

        } catch (err) {
          console.error('[UGC AI Pipeline] Error:', err.message);
          await UGCVideo.findByIdAndUpdate(doc._id, { processingStatus: 'failed' });
        }
      })();
    }

    res.json({ success: true, status: doc.status, message: 'Edit request submitted. AI processing started.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/ugc-video/:id/accept
// MobileUser accepts the edited video
exports.acceptEditedVideo = async (req, res) => {
  try {
    const doc = await UGCVideo.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    if (req.user.role === 'mobileuser' && String(doc.userId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (doc.status !== 'edited') {
      return res.status(400).json({ success: false, message: `Cannot accept video with status: ${doc.status}. Video must be in 'edited' status.` });
    }

    doc.status = 'approved';
    await doc.save();

    await UGCPrompter.findByIdAndUpdate(doc.promptId, { status: 'approved' });

    let editedVideoUrl = '';
    if (doc.editedVideoKey) {
      try { editedVideoUrl = await getobject(doc.editedVideoKey); } catch { editedVideoUrl = ''; }
    }

    res.json({ success: true, status: doc.status, editedVideoUrl, message: 'Video accepted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/ugc-video/:id/reject
// MobileUser rejects the edited video (sends back for re-edit)
exports.rejectEditedVideo = async (req, res) => {
  try {
    const { reason } = req.body;

    const doc = await UGCVideo.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    if (req.user.role === 'mobileuser' && String(doc.userId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (doc.status !== 'edited') {
      return res.status(400).json({ success: false, message: `Cannot reject video with status: ${doc.status}. Video must be in 'edited' status.` });
    }

    doc.status = 'rejected';
    if (reason) doc.objectionNotes = reason;
    await doc.save();

    await UGCPrompter.findByIdAndUpdate(doc.promptId, { status: 'rejected' });

    res.json({ success: true, status: doc.status, message: 'Video rejected.' });
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
      if (String(doc.clientId) !== clientId && String(doc.clientId) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
      }
    }

    doc.editedVideoKey = videoKey.trim();
    
    if (doc.autoApprovalSettings?.finalEditedVideo) {
      doc.status = 'approved';
    } else {
      doc.status = 'edited';
    }
    
    await doc.save();

    await UGCPrompter.findByIdAndUpdate(doc.promptId, { status: doc.status });

    let editedVideoUrl = '';
    try { editedVideoUrl = await getobject(doc.editedVideoKey); } catch { editedVideoUrl = ''; }

    console.log(`[UGC Edited] Video ${doc._id} editedVideoKey=${doc.editedVideoKey} status=${doc.status}`);

    res.json({ success: true, status: doc.status, editedVideoKey: doc.editedVideoKey, editedVideoUrl });
  } catch (err) {
    console.error('[UGC Edited] Error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
