const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  campaignName: {
    type: String,
    required: true,
    trim: true
  },
  clientId: {
    type: String,
    required: true
  },
  campaignId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  businessInterest: {
    type: String,
    required: true,
    trim: true
  },
  numberOfGroups: {
    type: Number,
    default: 0
  },
  numberOfMembers: {
    type: Number,
    default: 0
  },
  maxMembers: {
    type: Number,
    required: true
  },
  groupIds: {
    type: [String],
    required: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model('Campaign', campaignSchema); 