const mongoose = require('mongoose');

const sharedReelsSchema = new mongoose.Schema({
  googleId: {
    type: String,
    required: true,
    index: true
  },
  reels: [
    {
      reelId: {
        type: String,
        ref: 'Reel',
        default: '',
      },
      campaignTaskId: {
        type: String,
        default: '',
      },
      contentCategory: {
        type: String,
        enum: ['reels', 'post', 'ugc', 'app_review', 'gmb_review'],
        default: 'reels',
      },
      s3Key: {
        type: String
      },
      s3Url: {
        type: String
      },
      campaignId:{
        type:String
      },
      campaignName:{
        type: String,
        default: ''
      },
      credits:{
        type: Number,
        default: 0
      },
      title: {
        type: String,
        default: ''
      },
      campaignImageKey: {
        type: String,
        default: ''
      },
      isTaskComplete: {
        type: Boolean,
        default: false
      },
      isTaskAccepted: {
        type: Boolean,
        default: false
      },
      TaskStatus: {
        type: String,
        default: 'assigned',
        enum: ['assigned', 'pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'rejected'],
      },
      acceptedAt: { type: Date, default: null },
      inProgressAt: { type: Date, default: null },
      cancelledAt: { type: Date, default: null },
      penaltyApplied: { type: Boolean, default: false },
      creditsPenalized: { type: Number, default: 0 },
      timerExpired: { type: Boolean, default: false },
      cancellationReason: { type: String, default: '' },
      submissionStatus: {
        type: String,
        enum: ['none', 'pending_review', 'approved', 'rejected', 'completed'],
        default: 'none',
      },
      taskCode: {
        type: String,
        default: ''
      },
      campaignType: {
        type: String,
        enum: ['public', 'private'],
        default: 'private'
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }
  ],
  /** Daily accept log — persists after cancel so 3/day limit is enforced */
  acceptLog: [{
    acceptedAt: { type: Date, default: Date.now },
    reelId: { type: String, default: '' },
    campaignId: { type: String, default: '' },
  }],
});

module.exports = mongoose.model('SharedReels', sharedReelsSchema); 