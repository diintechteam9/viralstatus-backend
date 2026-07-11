const mongoose = require('mongoose');

const ugcVideoSchema = new mongoose.Schema({
  promptId:  { type: mongoose.Schema.Types.ObjectId, ref: 'UGCPrompter', required: true, index: true },
  userId:    { type: String, required: true, index: true },   // from JWT token
  clientId:  { type: String, required: true, index: true },   // from JWT token
  videoKey:  { type: String, required: true },                 // R2 key
  videoUrl:  { type: String, default: '' },                    // signed URL (refreshed on GET)
  status:    { type: String, enum: ['pending', 'client_review', 'submitted', 'editing_requested', 'editing', 'edited', 'approved', 'objection', 'rejected'], default: 'client_review' },
  note:      { type: String, default: '' },                    // optional note from user
  editedVideoKey: { type: String, default: '' },
  editedVideoUrl: { type: String, default: '' },
  objectionNotes: { type: String, default: '' },
  // AI Processing Pipeline
  aiJobId:           { type: String, default: '' },       // job_id from AI server
  processingStatus:  { type: String, enum: ['none', 'uploading', 'processing', 'completed', 'failed'], default: 'none' },
  processingProgress:{ type: Number, default: 0 },
  processedVideoKey: { type: String, default: '' },       // R2 key of AI-processed video
  processedVideoUrl: { type: String, default: '' },       // signed URL
  viralVideoKey:     { type: String, default: '' },       // viral variant from AI
  viralVideoUrl:     { type: String, default: '' },
  autoApprovalSettings: {
    recording: { type: Boolean, default: false },
    editingRequest: { type: Boolean, default: false },
    finalEditedVideo: { type: Boolean, default: false }
  }
}, { timestamps: true });

module.exports = mongoose.model('UGCVideo', ugcVideoSchema);
