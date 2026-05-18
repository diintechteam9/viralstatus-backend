const mongoose = require('mongoose');

const SocialMentionSchema = new mongoose.Schema({
  clientId:      { type: String, required: true, index: true },
  jobId:         { type: String, required: true, index: true },
  brand:         { type: String, required: true },
  keyword:       { type: String, required: true },
  platform:      { type: String, required: true },
  contentType:   { type: String, required: true },
  tone:          { type: String, default: 'Professional' },
  generatedText: { type: String, default: '' },
  status:        { type: String, enum: ['pending','ready','published','scheduled','failed'], default: 'pending' },
  scheduledAt:   { type: Date, default: null },
  publishedAt:   { type: Date, default: null },
  errorMsg:      { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('SocialMention', SocialMentionSchema);
