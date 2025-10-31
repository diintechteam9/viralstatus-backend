const mongoose = require('mongoose');

const ImagePoolSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  category: {
    type: String,
    trim: true
  },
  imageCount: {
    type: Number,
    default: 0
  },
}, {
  timestamps: true
});

module.exports = mongoose.model('ImagePool', ImagePoolSchema);
