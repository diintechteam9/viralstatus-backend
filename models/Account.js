const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true },
  type: { type: String, required: true },
  profilePic: { type: String, default: 'https://via.placeholder.com/40' },
  connected: { type: Boolean, default: true }
});

module.exports = mongoose.model('Account', AccountSchema);