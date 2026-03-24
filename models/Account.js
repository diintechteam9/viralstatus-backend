const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
  // existing fields
  name: { type: String },
  username: { type: String },
  type: { type: String },
  profilePic: { type: String, default: 'https://via.placeholder.com/40' },
  connected: { type: Boolean, default: true },

  // YouTube tokens stored per user
  // Stored as String so both ObjectId.toString() and raw string queries match
  userId: { type: String, index: true },
  youtubeTokens: { type: Object, default: null },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Account', AccountSchema);
