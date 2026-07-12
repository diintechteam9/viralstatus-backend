const mongoose = require('mongoose');

const ugcPrompterSchema = new mongoose.Schema({
  clientId:    { type: String, required: true, index: true },
  campaignId:  { type: String, default: '' },
  title:       { type: String, required: true, trim: true },
  category:    {
    type: String,
    enum: ['testimonial', 'demo', 'unboxing', 'tutorial', 'review', 'lifestyle', 'challenge', 'other'],
    default: 'testimonial',
  },
  platform:    {
    type: String,
    enum: ['instagram', 'youtube', 'both'],
    default: 'instagram',
  },
  tone:        {
    type: String,
    enum: ['casual', 'professional', 'funny', 'emotional', 'energetic'],
    default: 'casual',
  },
  duration:    { type: Number, default: 30 },
  brandName:   { type: String, default: '' },
  productName: { type: String, default: '' },
  keyPoints:   { type: [String], default: [] },
  prompt:      { type: String, default: '' },
  script:      { type: String, default: '' },
  hashtags:    { type: [String], default: [] },
  status:      {
    type: String,
    enum: ['pending', 'submitted', 'edited', 'approved', 'objection', 'rejected', 'archived'],
    default: 'pending',
  },
  isAiGenerated: { type: Boolean, default: false },
  autoApprovalSettings: {
    recording: { type: Boolean, default: false },
    editingRequest: { type: Boolean, default: false },
    finalEditedVideo: { type: Boolean, default: false }
  }
}, { timestamps: true });

module.exports = mongoose.model('UGCPrompter', ugcPrompterSchema);
