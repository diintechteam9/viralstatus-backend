const mongoose = require('mongoose');

const YouTubeScheduleSchema = new mongoose.Schema({
  userId:       { type: String, index: true },   // stored as string for consistent querying
  userModel:    { type: String, enum: ['Client', 'User'] },
  title:        { type: String, required: true },
  description:  { type: String, default: '' },
  tags:         { type: [String], default: [] },
  privacy:      { type: String, enum: ['public', 'private', 'unlisted'], default: 'public' },
  isShort:      { type: Boolean, default: false },
  videoPath:    { type: String },        // temp file path on server
  videoUrl:     { type: String },        // S3/R2 URL if stored
  scheduledAt:  { type: Date, required: true },
  status:       { type: String, enum: ['pending', 'published', 'failed'], default: 'pending' },
  youtubeId:    { type: String, default: '' },
  youtubeUrl:   { type: String, default: '' },
  error:        { type: String, default: '' },
  tokens:       { type: Object },        // user's OAuth tokens
}, { timestamps: true });

module.exports = mongoose.model('YouTubeSchedule', YouTubeScheduleSchema);
