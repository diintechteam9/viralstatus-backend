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
        required: true
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
      TaskStatus : {
        type: String,
        default: 'assigned'
      },
      createdAt:{
        type: Date,
        default: Date.now
      }
    }
  ]
});

module.exports = mongoose.model('SharedReels', sharedReelsSchema); 