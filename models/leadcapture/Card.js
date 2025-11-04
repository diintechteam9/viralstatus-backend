const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'archived'],
    default: 'active'
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 50
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
cardSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for better query performance
cardSchema.index({ name: 1 });
cardSchema.index({ status: 1 });
cardSchema.index({ createdAt: -1 });
cardSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Card', cardSchema);
