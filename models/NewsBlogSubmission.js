const mongoose = require('mongoose');

const newsBlogSubmissionSchema = new mongoose.Schema({
  taskId:      { type: mongoose.Schema.Types.ObjectId, ref: 'NewsBlogTask', required: true, index: true },
  newsBlogId:  { type: mongoose.Schema.Types.ObjectId, ref: 'NewsBlog', required: true },
  clientId:    { type: String, required: true },
  googleId:    { type: String, required: true, index: true }, // user's googleId

  postUrl:     { type: String, default: '' },   // submitted social media URL
  platform:    { type: String, default: '' },   // instagram | youtube | other

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },

  credits:          { type: Number, default: 0 },
  isCreditAwarded:  { type: Boolean, default: false },
  rejectionReason:  { type: String, default: '' },
  reviewedAt:       { type: Date, default: null },

}, { timestamps: true });

// One submission per user per task
newsBlogSubmissionSchema.index({ taskId: 1, googleId: 1 }, { unique: true });

module.exports = mongoose.model('NewsBlogSubmission', newsBlogSubmissionSchema);
