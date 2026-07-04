const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  clientId:    { type: String, default: 'admin', index: true },
  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  imageKey:    { type: String, default: '' }, // R2 storage key
  imageUrl:    { type: String, default: '' }, // presigned/public URL
  linkUrl:     { type: String, default: '' }, // optional tap link
  order:       { type: Number, default: 0 },  // for sorting
  isActive:    { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.models.Banner || mongoose.model('Banner', bannerSchema);
