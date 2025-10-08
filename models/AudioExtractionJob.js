const mongoose = require("mongoose");

const audioExtractionJobSchema = new mongoose.Schema({
    jobId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    
    status: {
        type: String,
        required: true,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    },
    
    progress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    
    // Original video file details
    originalVideoFile: {
        path: { type: String, required: true },
        originalName: { type: String, required: true },
        size: { type: Number, required: true },
        mimetype: { type: String, required: true }
    },
    
    // Extracted audio S3 storage details
    audioS3Key: {
        type: String,
        trim: true
    },
    
    audioS3Url: {
        type: String,
        trim: true
    },
    
    audioFileName: {
        type: String,
        trim: true
    },
    
    audioFileSize: {
        type: Number
    },
    
    audioContentType: {
        type: String,
        trim: true,
        default: 'audio/mpeg'
    },
    
    // Audio metadata
    audioDuration: {
        type: Number
    },
    
    // User information
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // Allow null for unauthenticated users
    },
    
    // Error handling
    error: {
        message: String,
        details: String,
        timestamp: Date
    },
    
    // Processing timestamps
    startedAt: {
        type: Date
    },
    
    completedAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Index for efficient querying
audioExtractionJobSchema.index({ status: 1, createdAt: -1 });
audioExtractionJobSchema.index({ userId: 1, createdAt: -1 });

// Method to update progress
audioExtractionJobSchema.methods.updateProgress = function(progress, status = null) {
    this.progress = Math.min(100, Math.max(0, progress));
    if (status) {
        this.status = status;
    }
    if (status === 'processing' && !this.startedAt) {
        this.startedAt = new Date();
    }
    if (status === 'completed' || status === 'failed') {
        this.completedAt = new Date();
    }
    return this.save();
};

// Method to set error
audioExtractionJobSchema.methods.setError = function(error) {
    this.status = 'failed';
    this.error = {
        message: error.message || 'Unknown error',
        details: error.details || error.toString(),
        timestamp: new Date()
    };
    this.completedAt = new Date();
    return this.save();
};

// Method to complete successfully
audioExtractionJobSchema.methods.complete = function(audioData) {
    this.status = 'completed';
    this.progress = 100;
    this.audioS3Key = audioData.s3Key;
    this.audioS3Url = audioData.s3Url;
    this.audioFileName = audioData.fileName;
    this.audioFileSize = audioData.fileSize;
    this.audioDuration = audioData.duration;
    this.audioContentType = audioData.contentType || 'audio/mpeg';
    this.completedAt = new Date();
    return this.save();
};

// Static method to create new job
audioExtractionJobSchema.statics.createJob = function(jobData) {
    const jobId = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return this.create({
        jobId,
        originalVideoFile: jobData.originalVideoFile,
        userId: jobData.userId
    });
};

// Static method to get job by ID
audioExtractionJobSchema.statics.getJobById = function(jobId) {
    return this.findOne({ jobId });
};

// Static method to get user's jobs
audioExtractionJobSchema.statics.getUserJobs = function(userId, limit = 10, skip = 0) {
    return this.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);
};

// Static method to cleanup old jobs (older than 7 days)
audioExtractionJobSchema.statics.cleanupOldJobs = function() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.deleteMany({
        createdAt: { $lt: sevenDaysAgo },
        status: { $in: ['completed', 'failed'] }
    });
};

const AudioExtractionJob = mongoose.model("AudioExtractionJob", audioExtractionJobSchema);

module.exports = AudioExtractionJob;
