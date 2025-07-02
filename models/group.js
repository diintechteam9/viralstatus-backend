const mongoose = require('mongoose');

const groupMemberSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

const groupSchema = new mongoose.Schema({
  groupId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  groupInterest: {
    type: String,
    required: true,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  numberOfMembers: {
    type: Number,
    default: 0
  },
  groupMembers: {
    type: [groupMemberSchema],
    default: []
  }
}, { timestamps: true });

groupSchema.index({ groupInterest: 1 });

module.exports = mongoose.model('Group', groupSchema); 