const mongoose = require("mongoose");

const videoJobSchema = new mongoose.Schema({
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
    
    // Video details
    cardName: {
        type: String,
        required: true,
        trim: true
    },
    
    category: {
        type: String,
        required: true,
        trim: true
    },
    
    // S3 storage details
    s3Key: {
        type: String,
        trim: true
    },
    
    s3Url: {
        type: String,
        trim: true
    },
    
    fileName: {
        type: String,
        trim: true
    },
    
    fileSize: {
        type: Number
    },
    
    // Audio S3 storage details (for generated/uploaded narration)
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
        trim: true
    },
    
    // Video metadata
    duration: {
        type: Number
    },
    
    audioDuration: {
        type: Number
    },
    
    imageCount: {
        type: Number
    },
    
    sentenceCount: {
        type: Number
    },
    
    // Link back to the card (project)
    cardId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'video',
        required: false
    },
    
    // Creation artifacts (for history/repro)
    storyScript: {
        type: String
    },
    
    sentenceSrt: {
        type: String
    },
    
    wordSrt: {
        type: String
    },

    // Image prompts used to generate images (same order as images)
    imagePrompts: {
        type: [String],
        default: []
    },

    // Saved image assets in S3 (sequence preserved by index)
    imageAssets: [
        {
            index: { type: Number },
            s3Key: { type: String, trim: true },
            s3Url: { type: String, trim: true },
            fileName: { type: String, trim: true },
            fileSize: { type: Number }
        }
    ],
    
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
    },
    
    // Request data (for debugging/reprocessing)
    requestData: {
        imageCount: Number,
        hasAudio: Boolean,
        hasOverlaySRT: Boolean,
        hasImageTimingSRT: Boolean
    }
}, {
    timestamps: true
});

// Index for efficient querying
videoJobSchema.index({ status: 1, createdAt: -1 });
videoJobSchema.index({ userId: 1, createdAt: -1 });
videoJobSchema.index({ cardName: 1, category: 1 });
videoJobSchema.index({ cardId: 1, createdAt: -1 });

// Virtual for formatted duration
videoJobSchema.virtual('formattedDuration').get(function() {
    if (!this.duration) return null;
    const minutes = Math.floor(this.duration / 60);
    const seconds = Math.floor(this.duration % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
});

// Method to update progress
videoJobSchema.methods.updateProgress = function(progress, status = null) {
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
videoJobSchema.methods.setError = function(error) {
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
videoJobSchema.methods.complete = function(videoData) {
    this.status = 'completed';
    this.progress = 100;
    this.s3Key = videoData.s3Key;
    this.s3Url = videoData.s3Url;
    this.fileName = videoData.fileName;
    this.fileSize = videoData.fileSize;
    this.duration = videoData.duration;
    this.audioDuration = videoData.audioDuration;
    this.imageCount = videoData.imageCount;
    this.sentenceCount = videoData.sentenceCount;
    this.completedAt = new Date();
    return this.save();
};

// Static method to create new job
videoJobSchema.statics.createJob = function(jobData) {
    const jobId = `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return this.create({
        jobId,
        cardName: jobData.cardName,
        category: jobData.category,
        cardId: jobData.cardId,
        userId: jobData.userId,
        requestData: jobData.requestData,
        storyScript: jobData.storyScript,
        sentenceSrt: jobData.sentenceSrt,
        wordSrt: jobData.wordSrt,
        imagePrompts: Array.isArray(jobData.imagePrompts) ? jobData.imagePrompts : []
    });
};

// Static method to get job by ID
videoJobSchema.statics.getJobById = function(jobId) {
    return this.findOne({ jobId });
};

// Static method to get user's jobs
videoJobSchema.statics.getUserJobs = function(userId, limit = 10, skip = 0) {
    return this.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);
};

// Static method to get jobs by card
videoJobSchema.statics.getCardJobs = function(cardId, limit = 20, skip = 0) {
    const query = cardId ? { cardId } : {};
    return this.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);
};

// Static method to cleanup old jobs (older than 7 days)
videoJobSchema.statics.cleanupOldJobs = function() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.deleteMany({
        createdAt: { $lt: sevenDaysAgo },
        status: { $in: ['completed', 'failed'] }
    });
};

const VideoJob = mongoose.model("VideoJob", videoJobSchema);

module.exports = VideoJob;
