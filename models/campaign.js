const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  campaignName: {
    type: String,
    required: true,
    trim: true
  },
  brandName:{
    type: String,
    required: true,
    trim: true
  },
  goal:{
    type: String,
    required: true
  },
  clientId: {
    type: String,
    required: true
  },
  activeParticipants: {
    type: Number,
    default: 0,
  },
  
  groupIds: {
    type: [String],
    required: false
  },
  userIds: {
    type: [String],
    required: false,
    default: [],
    validate: {
      validator: function(arr) {
        return arr.length === new Set(arr).size;
      },
      message: 'Duplicate userIds not allowed'
    }
  },
  image: {
    key: { type: String, required: true },
    url: { type: String }
  },
  categoryImage: {
    key: { type: String, default: '' },
    url: { type: String, default: '' }
  },
  brandImage: {
    key: { type: String, default: '' },
    url: { type: String, default: '' }
  },
  description: {
    type: String,
    required: true
  },
  startDate: {
    type: Date,
    required: true,
    validate: {
      validator: function(val) {
        return val instanceof Date && !isNaN(val);
      },
      message: 'Invalid start date'
    }
  },
  endDate: {
    type: Date,
    required: true,
    validate: {
      validator: function(val) {
        return val instanceof Date && !isNaN(val) && val > this.startDate;
      },
      message: 'End date must be after start date'
    }
  },
  tags: {
    type: [String],
    required: false
  },
  limit: {
    type: Number,
    required: false,
    default: 0
  },
  views:{
    type: String,
    required: false,
    default: '0'
  },
  credits:{
    type: Number,
    required: false,
    default: 0
  },
  location:{
    type: String,
    required: true
  },
  tNc:{
    type: String,
  },
  status: {
    type: String,
    required: true,
    default: "Active"
  },
  isActive: {
    type: Boolean,
    default: true
  },
  cutoff:{
    type: Number,
    required: false,
    default: 0
  },
  category: {
    type: String,
    default: ''
  },
  autoApproval: {
    type: Boolean,
    default: false
  },
  cancellationPenalty: {
    type: Number,
    default: 2,
    validate: {
      validator: function(val) {
        return val >= 0;
      },
      message: 'Cancellation penalty must be non-negative'
    }
  },
  penaltyThresholdMinutes: {
    type: Number,
    default: 10,
    validate: {
      validator: function(val) {
        return val > 0;
      },
      message: 'Penalty threshold must be greater than 0'
    }
  },
  dailyTaskAcceptLimit: {
    type: Number,
    default: 3,
    validate: {
      validator: function(val) {
        return val > 0;
      },
      message: 'Daily task accept limit must be greater than 0'
    }
  },
  allowCancellation: {
    type: Boolean,
    default: true
  },
  campaignType: {
    type: String,
    enum: ['public', 'private'],
    default: 'private'
  },
  /** Supported task formats: reels, post, ugc, app_review, gmb_review */
  supportedTaskTypes: {
    type: [String],
    default: ['reels'],
  },
}, { timestamps: true });

module.exports = mongoose.models.Campaign || mongoose.model('Campaign', campaignSchema); 