const mongoose = require('mongoose');

const ugcPrompterSchema = new mongoose.Schema({
  clientId:    { type: String, required: true, index: true },
  campaignId:  { type: String, default: '' },
  title:       { type: String, required: true, trim: true },
  category:    {
    type: String,
    enum: ['testimonial', 'unboxing', 'tutorial', 'review', 'lifestyle', 'challenge', 'other'],
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
  duration:    { type: Number, default: 30 },   // seconds
  brandName:   { type: String, default: '' },
  productName: { type: String, default: '' },
  keyPoints:   { type: [String], default: [] },  // bullet points to cover
  prompt:      { type: String, required: true }, // generated/manual prompt text
  script:      { type: String, default: '' },    // optional full script
  hashtags:    { type: [String], default: [] },
  status:      {
    type: String,
    enum: ['draft', 'active', 'archived'],
    default: 'active',
  },
  isAiGenerated: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('UGCPrompter', ugcPrompterSchema);
