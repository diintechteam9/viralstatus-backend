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
  },
  cutoff:{
    type: Number,
    required: true
  },
  category: {
    type: String,
    default: ''
  }
}, { timestamps: true });

module.exports = mongoose.model('Campaign', campaignSchema); 