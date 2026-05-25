const mongoose = require('mongoose');

const newsBlogCommentSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'NewsBlog', required: true, index: true },
  authorName: { type: String, required: true, trim: true, maxlength: 80 },
  text: { type: String, required: true, trim: true, maxlength: 2000 },
  visitorId: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('NewsBlogComment', newsBlogCommentSchema);
