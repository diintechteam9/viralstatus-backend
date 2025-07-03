const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const PoolSchema = new mongoose.Schema({
  poolId: {
    type: String,
    required: true,
    unique: true,
    default: uuidv4
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  reelCount: {
    type: Number,
    default: 0
  },
  clientId: {
    type: String,
    required: true
  },
  reelsUrl: [
    {
      key: { type: String, default: null},
      url: { type: String, default: null}
    }
  ]
}, {
  timestamps: true
});

module.exports = mongoose.model('Pool', PoolSchema); 