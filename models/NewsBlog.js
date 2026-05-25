const mongoose = require('mongoose');

const mediaItemSchema = new mongoose.Schema({
  type: { type: String, enum: ['image', 'video'], default: 'image' },
  url: { type: String, required: true },
  caption: { type: String, default: '' },
}, { _id: true });

const newsBlogSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  category: { type: String, default: 'News', enum: ['News', 'Blog', 'Announcement', 'Update', 'Tips'] },
  summary: { type: String, default: '' },
  content: { type: String, required: true },
  author: { type: String, default: 'Admin' },
  tags: { type: [String], default: [] },
  imageUrl: { type: String, default: '' },
  media: { type: [mediaItemSchema], default: [] },
  published: { type: Boolean, default: true },
  likesCount: { type: Number, default: 0 },
  shareCount: { type: Number, default: 0 },
  likedBy: { type: [String], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('NewsBlog', newsBlogSchema);
