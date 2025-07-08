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
  members: {
    type: [String],
    required: false,
    default: []
  },
  image: {
    key: { type: String, required: true },
  },
  description: {
    type: String,
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  tags: {
    type: [String],
    required: false
  },
  limit: {
    type: Number,
    required: true
  },
  views:{
    type: String,
    required: true
  },
  credits:{
    type: Number,
    required:true
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
  }
}, { timestamps: true });

module.exports = mongoose.model('Campaign', campaignSchema); 