const mongoose = require('mongoose');

const newsBlogTaskSchema = new mongoose.Schema({
  // Link to the news/blog post
  newsBlogId:   { type: mongoose.Schema.Types.ObjectId, ref: 'NewsBlog', required: true },
  clientId:     { type: String, required: true },

  // Task meta (copied from post for display)
  title:        { type: String, required: true, trim: true },
  summary:      { type: String, default: '' },
  imageUrl:     { type: String, default: '' },
  category:     { type: String, default: 'News' },
  content:      { type: String, default: '' },

  // Task config
  credits:      { type: Number, required: true, default: 10 },
  deadline:     { type: Date, default: null },
  platform:     { type: String, enum: ['instagram', 'youtube', 'both', 'any'], default: 'any' },
  instructions: { type: String, default: '' },

  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'draft'],
    default: 'active',
  },

  // Users assigned to this task
  assignedTo:  { type: [String], default: [] }, // googleIds

}, { timestamps: true });

module.exports = mongoose.model('NewsBlogTask', newsBlogTaskSchema);
