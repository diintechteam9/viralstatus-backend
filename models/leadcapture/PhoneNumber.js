const mongoose = require('mongoose');

const phoneNumberSchema = new mongoose.Schema({
  cardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Card',
    required: true
  },
  screenshot: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Screenshot',
    required: true  
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true
  },
  formattedNumber: {
    type: String,
    required: true
  },
  countryCode: {
    type: String,
    default: ''
  },
  confidence: {
    type: Number,
    min: 0,
    max: 1,
    default: 0.8
  },
  position: {
    x: {
      type: Number,
      default: 0
    },
    y: {
      type: Number,
      default: 0
    },
    width: {
      type: Number,
      default: 0
    },
    height: {
      type: Number,
      default: 0
    }
  },
  context: {
    type: String,
    default: ''
  },
  name: {
    type: String,
    default: '',
    trim: true
  },
  email: {
    type: String,
    default: '',
    trim: true
  },
  isValid: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for better query performance
phoneNumberSchema.index({ cardId: 1 });
phoneNumberSchema.index({ screenshot: 1 });
phoneNumberSchema.index({ phoneNumber: 1 });
phoneNumberSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PhoneNumber', phoneNumberSchema);
