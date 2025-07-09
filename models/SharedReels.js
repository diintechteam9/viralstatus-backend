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
      isTaskCompleted: {
        type: Boolean,
        default: false
      }
    }
  ]
});

module.exports = mongoose.model('SharedReels', sharedReelsSchema); 