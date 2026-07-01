const mongoose = require('mongoose');

const campaignTaskSchema = new mongoose.Schema({
  campaignId: { type: String, required: true, index: true },
  clientId:   { type: String, required: true },

  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  platform: {
    type: String,
    required: true,
    enum: ['instagram', 'youtube', 'both'],
  },

  taskType: {
    type: String,
    required: true,
    enum: ['like', 'comment', 'view', 'follow', 'upload_reel', 'share', 'save'],
  },

  /** Campaign content category: reels, post, ugc, app_review, gmb_review */
  contentCategory: {
    type: String,
    enum: ['reels', 'post', 'ugc', 'app_review', 'gmb_review'],
    default: 'post',
    index: true,
  },

  targetUrl:   { type: String, default: '' },   // URL user must interact with
  targetCount: { type: Number, default: 1 },    // e.g. get 100 views
  credits:     { type: Number, required: true }, // credits on completion

  proofRequired: {
    type: String,
    enum: ['screenshot', 'url', 'none'],
    default: 'screenshot',
  },

  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'draft'],
    default: 'active',
  },

  assignedTo: { type: [String], default: [] }, // googleIds
  completedBy: { type: [String], default: [] },

  visibility: {
    type: String,
    enum: ['public', 'private'],
    default: 'private',
  },

  // For public task completions — proof submitted by users
  submissions: [{
    userId:      { type: String, required: true },
    proofUrl:    { type: String, default: '' },  // signed URL (may expire) or local URL
    proofKey:    { type: String, default: '' },  // R2 key — use this to generate fresh URL
    submittedAt: { type: Date, default: Date.now },
    status:      { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  }],

  deadline: { type: Date, default: null },
  order:    { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('CampaignTask', campaignTaskSchema);
