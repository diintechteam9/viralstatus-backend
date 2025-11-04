const mongoose = require('mongoose');

const screenshotSchema = new mongoose.Schema({
  cardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card',
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  url: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: ''
  },
  processed: {
    type: Boolean,
    default: false
  },
  fileCleaned: {
    type: Boolean,
    default: false
  },
  phoneNumbers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PhoneNumber'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
screenshotSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for better query performance
screenshotSchema.index({ cardId: 1 });
screenshotSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Screenshot', screenshotSchema);
