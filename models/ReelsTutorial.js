const mongoose = require('mongoose');

const reelsTutorialSchema = new mongoose.Schema({
  clientId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  category: {
    type: String,
    enum: ['reels', 'post', 'ugc', 'app_review', 'gmb_review', 'general'],
    default: 'reels',
  },
  description: { type: String, default: '' },
  videoUrl: { type: String, default: '' },
  steps: [{ type: String }],
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.models.ReelsTutorial || mongoose.model('ReelsTutorial', reelsTutorialSchema);
