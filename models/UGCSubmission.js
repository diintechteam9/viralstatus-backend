const mongoose = require('mongoose');

const ugcSubmissionSchema = new mongoose.Schema({
  campaignId:     { type: String, required: true },
  campaignTaskId: { type: String, required: true }, // scopes submission to specific task assignment
  userId:         { type: String, required: true },  // googleId
  videoKey:       { type: String, required: true },  // R2 key
  videoUrl:       { type: String, default: '' },
  status:         { type: String, default: 'pending' }, // pending | approved | rejected
  videoDuration:  { type: Number, default: 0 },
  creditsEarned:  { type: Number, default: 0 },
  creditsAwarded: { type: Boolean, default: false },
}, { timestamps: true });

// Unique per task assignment — allows re-submission after rejection on a new task
ugcSubmissionSchema.index({ campaignTaskId: 1, userId: 1 }, { unique: true });
// Keep campaignId+userId index for lookups (non-unique)
ugcSubmissionSchema.index({ campaignId: 1, userId: 1 });

module.exports = mongoose.model('UGCSubmission', ugcSubmissionSchema);
