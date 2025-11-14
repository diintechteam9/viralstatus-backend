const mongoose = require('mongoose');

const pendingTemplateSchema = new mongoose.Schema({
  // Meta identifiers
  metaTemplateId: { type: String, index: true },
  name: { type: String, required: true },
  language: { type: String, required: true },
  category: { type: String },
  status: { type: String, default: 'pending' },
  quality_score: { type: String },

  // Store the raw components as Meta returns them so we can re-use
  components: { type: Array },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true },

  // Keep the whole raw object for reference/debugging
  metaRaw: { type: Object },
}, { timestamps: true });

pendingTemplateSchema.index({ name: 1, language: 1 }, { unique: true });

const PendingTemplate = mongoose.model('PendingTemplate', pendingTemplateSchema);
module.exports = PendingTemplate;

