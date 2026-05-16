const mongoose = require('mongoose');

const PoolFolderSchema = new mongoose.Schema({
  poolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Pool',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  reelCount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('PoolFolder', PoolFolderSchema);
