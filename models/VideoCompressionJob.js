const mongoose = require('mongoose');

const videoCompressionJobSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  originalFileName: {
    type: String,
    required: true
  },
  originalFilePath: {
    type: String,
    required: true
  },
  compressedFilePath: {
    type: String,
    default: null
  },
  targetQuality: {
    type: String,
    required: true,
    enum: ['720p', '480p', '360p', '240p', '144p', 'custom']
  },
  customSettings: {
    width: Number,
    height: Number,
    bitrate: String,
    crf: Number
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  errorMessage: {
    type: String,
    default: null
  },
  originalFileSize: {
    type: Number,
    required: true
  },
  compressedFileSize: {
    type: Number,
    default: null
  },
  compressionRatio: {
    type: Number,
    default: null
  },
  processingTime: {
    type: Number, // in seconds
    default: null
  },
  ffmpegCommand: {
    type: String,
    default: null
  },
  tempFiles: [{
    type: String // Array of temporary file paths to clean up
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date,
    default: null
  }
});

// Update the updatedAt field before saving
videoCompressionJobSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Calculate compression ratio
videoCompressionJobSchema.methods.calculateCompressionRatio = function() {
  if (this.originalFileSize && this.compressedFileSize) {
    this.compressionRatio = ((this.originalFileSize - this.compressedFileSize) / this.originalFileSize * 100).toFixed(2);
  }
  return this.compressionRatio;
};

// Check if job is in progress
videoCompressionJobSchema.methods.isInProgress = function() {
  return this.status === 'pending' || this.status === 'processing';
};

// Check if job is completed
videoCompressionJobSchema.methods.isCompleted = function() {
  return this.status === 'completed';
};

// Check if job failed
videoCompressionJobSchema.methods.hasFailed = function() {
  return this.status === 'failed';
};

module.exports = mongoose.model('VideoCompressionJob', videoCompressionJobSchema);
