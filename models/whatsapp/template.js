const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  category: { type: String, required: true },
  language: { type: String, required: true },
  parameter_format: { type: String, enum: ['NAMED', 'POSITIONAL'], required: false },
  allow_category_change: { type: Boolean, default: false },
  components: { type: Array, required: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true },

  status: { type: String, enum: ['draft', 'submitted', 'pending', 'approved', 'rejected', 'failed'], default: 'draft' },
  metaTemplateId: { type: String },
  metaRaw: { type: Object },
  lastError: { type: Object }
}, { timestamps: true });

const Template = mongoose.model('Template', templateSchema);
module.exports = Template;




