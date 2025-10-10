const mongoose = require('mongoose');

const videoToSegmentsJobSchema = new mongoose.Schema({
    jobId: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    userId: { type: String, default: null },

    originalVideoFile: {
        path: String,
        originalName: String,
        size: Number,
        mimetype: String
    },
    outroFile: {
        path: String,
        originalName: String,
        size: Number,
        mimetype: String
    },
    logoFile: {
        path: String,
        originalName: String,
        size: Number,
        mimetype: String
    },

    srt: { type: String, required: true },
    wordSrt: { type: String, default: null },
    paragraphs: [{ type: String }],
    paddingSeconds: { type: Number, default: 0.3 },
    portrait: { type: Boolean, default: false },
    fontKey: { type: String, default: 'notosans' },
    textColor: { type: String, default: 'white' },
    logoPosition: { type: String, default: 'top-right' },
    cropPosition: { type: String, default: 'middle' },

    videos: [{
        url: String,
        key: String,
        fileName: String,
        fileSize: Number,
        index: Number
    }],

    error: {
        message: String,
        details: String,
        stack: String
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null }
});

videoToSegmentsJobSchema.index({ userId: 1, createdAt: -1 });
videoToSegmentsJobSchema.index({ status: 1, createdAt: -1 });

videoToSegmentsJobSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

videoToSegmentsJobSchema.statics.createJob = async function(jobData) {
    const jobId = `vts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const job = new this({
        jobId,
        userId: jobData.userId,
        originalVideoFile: {
            path: jobData.videoFile.path,
            originalName: jobData.videoFile.originalname,
            size: jobData.videoFile.size,
            mimetype: jobData.videoFile.mimetype
        },
        outroFile: jobData.outroFile || null,
        logoFile: jobData.logoFile || null,
        srt: jobData.srt,
        wordSrt: jobData.wordSrt,
        paragraphs: jobData.paragraphs,
        paddingSeconds: jobData.paddingSeconds,
        portrait: jobData.portrait,
        fontKey: jobData.fontKey,
        textColor: jobData.textColor,
        logoPosition: jobData.logoPosition,
        cropPosition: jobData.cropPosition || 'middle'
    });
    await job.save();
    return job;
};

videoToSegmentsJobSchema.statics.getJobById = async function(jobId) {
    return await this.findOne({ jobId });
};

videoToSegmentsJobSchema.methods.updateProgress = async function(progress, status) {
    this.progress = progress;
    if (status) this.status = status;
    this.updatedAt = new Date();
    await this.save();
    return this;
};

videoToSegmentsJobSchema.methods.complete = async function(videos) {
    this.status = 'completed';
    this.progress = 100;
    this.completedAt = new Date();
    this.updatedAt = new Date();
    this.videos = Array.isArray(videos) ? videos : [];
    await this.save();
    return this;
};

videoToSegmentsJobSchema.methods.setError = async function(error) {
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

videoToSegmentsJobSchema.methods.setPartialVideos = async function(videos, progress) {
    if (Array.isArray(videos)) {
        this.videos = videos;
    }
    if (typeof progress === 'number') {
        this.progress = Math.max(0, Math.min(99, progress));
    }
    if (this.status !== 'completed' && this.status !== 'failed') {
        this.status = 'processing';
    }
    this.updatedAt = new Date();
    await this.save();
    return this;
};

module.exports = mongoose.model('VideoToSegmentsJob', videoToSegmentsJobSchema);


