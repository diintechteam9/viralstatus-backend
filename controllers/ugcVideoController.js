const UGCPrompter = require('../models/UGCPrompter');
const UGCVideo    = require('../models/UGCVideo');
const { putobject, getobject, deleteObject } = require('../utils/r2');

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
// Video submit karo after R2 upload
// Body: { promptId, videoKey, note }
exports.submitVideo = async (req, res) => {
  try {
    const { promptId, videoKey, note } = req.body;
    if (!promptId || !videoKey) {
      return res.status(400).json({ success: false, message: 'promptId and videoKey are required' });
    }

    const userId   = String(req.user.id);
    const clientId = String(req.user.clientId || req.user.id);

    const doc = await UGCVideo.create({
      promptId, userId, clientId,
      videoKey,
      note: note || '',
    });

    res.status(201).json({
      success: true,
      video: {
        _id:       doc._id,
        promptId:  doc.promptId,
        videoKey:  doc.videoKey,
        status:    doc.status,
        note:      doc.note,
        createdAt: doc.createdAt,
      },
    });
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
    if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const clientId = String(req.user.clientId || req.user.id);
    const role = req.user.role;

    // Only client/appclient can update status
    if (role !== 'client' && role !== 'appclient') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const doc = await UGCVideo.findOne({ _id: req.params.id, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Video not found' });

    doc.status = status;
    await doc.save();

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
