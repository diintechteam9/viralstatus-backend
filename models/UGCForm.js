const mongoose = require('mongoose');

const ugcFormSchema = new mongoose.Schema({
  campaignId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  instructions: { type: String, required: true },
  script: { type: String, default: '' },
  referenceVideoUrl: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('UGCForm', ugcFormSchema);
