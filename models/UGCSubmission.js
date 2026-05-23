const mongoose = require('mongoose');

const ugcSubmissionSchema = new mongoose.Schema({
  campaignId: { type: String, required: true },
  userId: { type: String, required: true },   // googleId
  videoKey: { type: String, required: true },  // R2 key
  videoUrl: { type: String, default: '' },
  status: { type: String, default: 'pending' }, // pending | approved | rejected
}, { timestamps: true });

ugcSubmissionSchema.index({ campaignId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('UGCSubmission', ugcSubmissionSchema);
