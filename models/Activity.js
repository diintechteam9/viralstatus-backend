const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  // Who did it
  actorId:    { type: String, required: true, index: true },
  actorName:  { type: String, default: '' },
  actorRole:  { type: String, enum: ['user', 'client', 'admin'], default: 'user' },
  actorAvatar:{ type: String, default: '' },
  // What happened
  type: {
    type: String,
    enum: [
      'user_joined',       // new user registered
      'campaign_joined',   // user joined a campaign
      'campaign_completed',// user completed a campaign task
      'task_accepted',     // user accepted a task
      'task_completed',    // user submitted task
      'credits_earned',    // credits awarded
      'withdrawal_request',// withdraw initiated
      'withdrawal_paid',   // withdraw completed
      'kyc_submitted',     // kyc docs submitted
      'kyc_approved',      // kyc approved by admin
      'ugc_submitted',     // ugc video uploaded
      'review_posted',     // testimonial posted
      'client_created',    // admin created client
      'banner_updated',    // banner uploaded
    ],
    required: true,
    index: true,
  },
  // Context
  description: { type: String, default: '' },
  meta: {
    campaignId:   { type: String, default: '' },
    campaignName: { type: String, default: '' },
    credits:      { type: Number, default: 0 },
    amount:       { type: Number, default: 0 },
    taskId:       { type: String, default: '' },
    clientId:     { type: String, default: '' },
  },
  // Audience filter
  clientId: { type: String, default: '', index: true },
}, { timestamps: true });

// TTL index — auto-delete activities older than 90 days
activitySchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
