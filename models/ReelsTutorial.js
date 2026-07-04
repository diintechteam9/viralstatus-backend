const mongoose = require('mongoose');

const reelsTutorialSchema = new mongoose.Schema({
  clientId:    { type: String, required: true, index: true },
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  videoKey:    { type: String, default: '' },   // R2 storage key
  videoUrl:    { type: String, default: '' },   // presigned/public URL (refreshed on read)
  isActive:    { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.models.ReelsTutorial || mongoose.model('ReelsTutorial', reelsTutorialSchema);
