const mongoose = require('mongoose');

const videoToReelsJobSchema = new mongoose.Schema({
    jobId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    },
    progress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    userId: {
        type: String,
        default: null
    },
    
    // Video-to-reels specific data
    originalVideoFile: {
        path: String,
        originalName: String,
        size: Number,
        mimetype: String
    },
    srt: {
        type: String,
        required: true
    },
    wordSrt: {
        type: String,
        default: null
    },
    importantSentences: [{
        type: String
    }],
    paddingSeconds: {
        type: Number,
        default: 0.3
    },
    maxTotalSeconds: {
        type: Number,
        default: 60
    },
    portrait: {
        type: Boolean,
        default: false
    },
    fontKey: {
        type: String,
        default: 'notosans'
    },
    textColor: {
        type: String,
        default: 'white'
    },
    
    // Generated video data
    videoUrl: {
        type: String,
        default: null
    },
    s3Key: {
        type: String,
        default: null
    },
    s3Url: {
        type: String,
        default: null
    },
    fileName: {
        type: String,
        default: null
    },
    fileSize: {
        type: Number,
        default: null
    },
    duration: {
        type: Number,
        default: null
    },
    // Multiple generated videos
    videos: [{
        url: String,
        key: String,
        fileName: String,
        fileSize: Number,
        index: Number
    }],
    
    // Error handling
    error: {
        message: String,
        details: String,
        stack: String
    },
    
    // Timestamps
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

// Index for efficient queries
videoToReelsJobSchema.index({ userId: 1, createdAt: -1 });
videoToReelsJobSchema.index({ status: 1, createdAt: -1 });

// Update the updatedAt field before saving
videoToReelsJobSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Static methods
videoToReelsJobSchema.statics.createJob = async function(jobData) {
    const jobId = `vtr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const job = new this({
        jobId,
        userId: jobData.userId,
        originalVideoFile: {
            path: jobData.videoFile.path,
            originalName: jobData.videoFile.originalname,
            size: jobData.videoFile.size,
            mimetype: jobData.videoFile.mimetype
        },
        srt: jobData.srt,
        wordSrt: jobData.wordSrt,
        importantSentences: jobData.sentences,
        paddingSeconds: jobData.paddingSeconds,
        maxTotalSeconds: jobData.maxTotalSeconds,
        portrait: jobData.portrait,
        fontKey: jobData.fontKey,
        textColor: jobData.textColor
    });
    
    await job.save();
    return job;
};

videoToReelsJobSchema.statics.getJobById = async function(jobId) {
    return await this.findOne({ jobId });
};

videoToReelsJobSchema.statics.getJobsByUserId = async function(userId, limit = 50) {
    return await this.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit);
};

// Instance methods
videoToReelsJobSchema.methods.updateProgress = async function(progress, status) {
    this.progress = progress;
    this.status = status;
    this.updatedAt = new Date();
    await this.save();
    return this;
};

videoToReelsJobSchema.methods.complete = async function(videoData) {
    this.status = 'completed';
    this.progress = 100;
    this.completedAt = new Date();
    this.updatedAt = new Date();
    
    if (videoData) {
        this.videoUrl = videoData.url;
        this.s3Key = videoData.key;
        this.s3Url = videoData.url;
        this.fileName = videoData.fileName;
        this.fileSize = videoData.fileSize;
        this.duration = videoData.duration;
        if (Array.isArray(videoData.videos)) {
            this.videos = videoData.videos;
        }
    }
    
    await this.save();
    return this;
};

videoToReelsJobSchema.methods.setError = async function(error) {
    this.status = 'failed';
    this.error = {
        message: error.message,
        details: error.details || null,
        stack: error.stack || null
    };
    this.updatedAt = new Date();
    await this.save();
    return this;
};

module.exports = mongoose.model('VideoToReelsJob', videoToReelsJobSchema);
