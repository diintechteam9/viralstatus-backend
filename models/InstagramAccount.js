const mongoose = require('mongoose');

const instagramAccountSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  instagramId: {
    type: String,
    required: true,
    unique: true,
  },
  username: String,
  accessToken: {
    type: String,
    required: true
  },
  pageId: {
    type: String,
    required: true
  },
  pageName: String,
  profilePicture: String,
  connectedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('InstagramAccount', instagramAccountSchema);
