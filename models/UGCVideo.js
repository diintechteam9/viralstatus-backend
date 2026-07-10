const mongoose = require('mongoose');

const ugcVideoSchema = new mongoose.Schema({
  promptId:  { type: mongoose.Schema.Types.ObjectId, ref: 'UGCPrompter', required: true, index: true },
  userId:    { type: String, required: true, index: true },   // from JWT token
  clientId:  { type: String, required: true, index: true },   // from JWT token
  videoKey:  { type: String, required: true },                 // R2 key
  videoUrl:  { type: String, default: '' },                    // signed URL (refreshed on GET)
  status:    { type: String, enum: ['pending', 'submitted', 'edited', 'approved', 'objection', 'rejected'], default: 'submitted' },
  note:      { type: String, default: '' },                    // optional note from user
}, { timestamps: true });

module.exports = mongoose.model('UGCVideo', ugcVideoSchema);
