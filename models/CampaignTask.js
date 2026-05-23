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

  deadline: { type: Date, default: null },
  order:    { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('CampaignTask', campaignTaskSchema);
