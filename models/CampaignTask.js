const mongoose = require('mongoose');

const campaignTaskSchema = new mongoose.Schema({
  campaignId: { type: String, required: true, index: true },
  clientId:   { type: String, required: true },

  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '' },

  platform: {
    type: String,
    required: true,
    enum: ['instagram', 'youtube', 'both', 'playstore', 'appstore', 'reels'],
  },

  taskType: {
    type: String,
    required: true,
    enum: ['like', 'comment', 'view', 'follow', 'upload_reel', 'share', 'save', 'reels'],
  },

  /** Campaign content category: reels, post, ugc, app_review, gmb_review */
  contentCategory: {
    type: String,
    enum: ['reels', 'post', 'ugc', 'app_review', 'gmb_review'],
    default: 'post',
    index: true,
  },

  targetUrl:   { type: String, default: '' },
  targetCount: { type: Number, default: 1 },
  credits:     { type: Number, required: true },

  // App Review specific
  appName:    { type: String, default: '' },
  minRating:  { type: String, default: '5' },

  // GMB Review specific
  businessName: { type: String, default: '' },

  // UGC specific
  script:             { type: String, default: '' },
  referenceVideoUrl:  { type: String, default: '' },

  proofRequired: {
    type: String,
    enum: ['screenshot', 'url', 'video', 'none'],
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
    userId:       { type: String, required: true },
    proofUrl:     { type: String, default: '' },
    proofKey:     { type: String, default: '' },
    submittedAt:  { type: Date, default: Date.now },
    status:       { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    creditsGiven: { type: Number, default: 0 },
  }],

  deadline: { type: Date, default: null },
  order:    { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('CampaignTask', campaignTaskSchema);
