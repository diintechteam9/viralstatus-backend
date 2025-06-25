// models/Post.js

const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  title: String,
  content: String,
  status: String,
  scheduledFor: Date,
  media: Array,
  accounts: Array,
}, { timestamps: true });

module.exports = mongoose.model('Post', postSchema);
