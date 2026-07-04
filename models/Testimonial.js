const mongoose = require('mongoose');

const testimonialSchema = new mongoose.Schema({
  userId:   { type: String, required: true, index: true },
  userName: { type: String, default: '' },
  userCity: { type: String, default: '' },
  // User's avatar (R2 key or URL)
  avatarUrl: { type: String, default: '' },
  rating:    { type: Number, min: 1, max: 5, required: true },
  review:    { type: String, required: true, trim: true },
  // Optional: campaign they are reviewing about
  campaignId:   { type: String, default: '' },
  campaignName: { type: String, default: '' },
  // Moderation
  isApproved: { type: Boolean, default: false },
  isVisible:  { type: Boolean, default: true },
  clientId:   { type: String, default: '', index: true },
}, { timestamps: true });

module.exports = mongoose.models.Testimonial || mongoose.model('Testimonial', testimonialSchema);
