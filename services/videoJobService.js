const VideoJob = require('../models/VideoJob');
const { generateFinalVideoAsync } = require('../controllers/aivideogen/generatefinalvideocontroller');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

// Cloudinary config (uses env vars automatically if set, but explicit is safer)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Check if Cloudinary is configured
const isCloudinaryEnabled = () =>
    !!(process.env.CLOUDINARY_CLOUD_NAME &&
       process.env.CLOUDINARY_API_KEY &&
       process.env.CLOUDINARY_API_SECRET);

/**
 * Upload a Buffer to Cloudinary via a temp file.
 * resource_type: 'video' for mp4/audio, 'image' for jpg/png
 */
const uploadBufferToCloudinary = (buffer, options = {}) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });
        uploadStream.end(buffer);
    });
};

class VideoJobService {
    constructor() {
        this.activeJobs = new Map();
        this.maxConcurrentJobs = 3;
    }

    async createJob(jobData) {
        try {
            const job = await VideoJob.createJob({
                cardName: jobData.cardName,
                category: jobData.category,
                userId: jobData.userId,
                cardId: jobData.cardId,
                storyScript: jobData.storyScript,
                sentenceSrt: jobData.sentenceSrt,
                wordSrt: jobData.wordSrt,
                imagePrompts: jobData.imagePrompts,
                requestData: {
                    imageCount: jobData.images?.length || 0,
                    hasAudio: !!jobData.audio,
                    hasOverlaySRT: !!jobData.srt,
                    hasImageTimingSRT: !!(jobData.imageSrt || jobData.deepSrt)
                }
            });
            console.log(`Created video job: ${job.jobId} for card: ${job.cardName}`);
            return job;
        } catch (error) {
            console.error('Error creating video job:', error);
            throw error;
        }
    }

    async startJob(jobId, requestData) {
        try {
            const job = await VideoJob.getJobById(jobId);
            if (!job) throw new Error(`Job ${jobId} not found`);
            if (job.status !== 'pending') throw new Error(`Job ${jobId} is not in pending status`);
            if (this.activeJobs.size >= this.maxConcurrentJobs) {
                throw new Error('Maximum concurrent jobs reached. Please try again later.');
            }

            await job.updateProgress(0, 'processing');
            this.activeJobs.set(jobId, job);
            console.log(`Starting video job: ${jobId}`);

            // Fire and forget — background processing
            this.processVideoAsync(jobId, requestData);
            return job;
        } catch (error) {
            console.error(`Error starting job ${jobId}:`, error);
            throw error;
        }
    }

    async processVideoAsync(jobId, requestData) {
        try {
            const job = await VideoJob.getJobById(jobId);
            if (!job) { console.error(`Job ${jobId} not found during processing`); return; }

            console.log(`Processing video job: ${jobId}`);
            await job.updateProgress(10, 'processing');

            // Upload audio to Cloudinary (optional, non-blocking)
            if (requestData.audio) {
                try {
                    const audioBuffer = Buffer.from(requestData.audio, 'base64');
                    const audioResult = await this.saveAudioToCloudinary(audioBuffer, job.cardName, job.category);
                    job.audioS3Key  = audioResult.public_id;
                    job.audioS3Url  = audioResult.url;
                    job.audioFileName = audioResult.fileName;
                    job.audioFileSize = audioResult.fileSize;
                    job.audioContentType = 'audio/mpeg';
                    await job.save();
                    console.log(`Job ${jobId}: audio uploaded to Cloudinary`);
                } catch (e) {
                    console.warn(`Job ${jobId}: failed to upload audio to Cloudinary, continuing —`, e.message);
                }
            }

            // Upload images to Cloudinary (optional, non-blocking)
            if (Array.isArray(requestData.images) && requestData.images.length > 0) {
                try {
                    const savedAssets = [];
                    for (let i = 0; i < requestData.images.length; i++) {
                        const raw = requestData.images[i];
                        const base64 = typeof raw === 'string' ? raw : raw.image;
                        if (!base64 || typeof base64 !== 'string') continue;
                        const buffer = Buffer.from(base64, 'base64');
                        const asset = await this.saveImageToCloudinary(buffer, job.cardName, job.category, i);
                        savedAssets.push({
                            index: i,
                            s3Key: asset.public_id,
                            s3Url: asset.url,
                            fileName: asset.fileName,
                            fileSize: asset.fileSize
                        });
                    }
                    job.imageAssets = savedAssets;
                    await job.save();
                    console.log(`Job ${jobId}: ${savedAssets.length} images uploaded to Cloudinary`);
                } catch (e) {
                    console.warn(`Job ${jobId}: failed to upload images to Cloudinary, continuing —`, e.message);
                }
            }

            // Generate the final video
            const result = await generateFinalVideoAsync(requestData, {
                onProgress: async (progress, message) => {
                    const j = await VideoJob.getJobById(jobId);
                    if (j) {
                        const mapped = 10 + (progress * 0.8);
                        await j.updateProgress(mapped, 'processing');
                        console.log(`Job ${jobId} progress: ${mapped.toFixed(1)}% - ${message}`);
                    }
                }
            });

            await job.updateProgress(90, 'processing');

            // Save final video — Cloudinary first, local fallback
            let videoStore = null;
            try {
                videoStore = await this.saveVideoToCloudinary(result.video, job.cardName, job.category);
                console.log(`Job ${jobId}: video uploaded to Cloudinary — ${videoStore.url}`);
            } catch (storeErr) {
                console.warn(`Job ${jobId}: Cloudinary upload failed, falling back to local —`, storeErr?.message || storeErr);
                videoStore = await this.saveVideoToLocal(result.video, job.cardName, job.category);
            }

            // Update linked VideoCard if present
            if (job.cardId) {
                try {
                    const VideoCard = require('../models/aivideogen');
                    const existing = await VideoCard.findById(job.cardId);
                    if (existing) {
                        existing.latestVideoS3Key      = videoStore.public_id || videoStore.key || undefined;
                        existing.latestVideoUrl        = videoStore.url;
                        existing.latestVideoFileName   = videoStore.fileName;
                        existing.latestVideoFileSize   = videoStore.fileSize;
                        existing.latestVideoDuration   = result.duration;
                        existing.latestVideoCreatedAt  = new Date();
                        existing.updatedAt             = new Date();
                        await existing.save();
                    }
                } catch (cardErr) {
                    console.warn(`Job ${jobId}: failed to update video card metadata —`, cardErr.message);
                }
            }

            // Mark job complete
            await job.complete({
                s3Key:         videoStore.public_id || videoStore.key,
                s3Url:         videoStore.url,
                fileName:      videoStore.fileName,
                fileSize:      videoStore.fileSize,
                duration:      result.duration,
                audioDuration: result.audioDuration,
                imageCount:    result.imageCount,
                sentenceCount: result.sentenceCount
            });

            console.log(`✅ Video job completed: ${jobId}, URL: ${videoStore.url}`);

        } catch (error) {
            console.error(`Error processing video job ${jobId}:`, error);
            const job = await VideoJob.getJobById(jobId);
            if (job) await job.setError(error);
        } finally {
            this.activeJobs.delete(jobId);
        }
    }

    // ─── Cloudinary Helpers ───────────────────────────────────────────────────

    async saveVideoToCloudinary(videoBuffer, cardName, category) {
        if (!isCloudinaryEnabled()) throw new Error('Cloudinary not configured');

        const sanitizedCardName = String(cardName || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const sanitizedCategory = String(category || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const timestamp = Date.now();
        const publicId = `viralstatus/videos/${sanitizedCategory}/${sanitizedCardName}_${timestamp}`;

        const result = await uploadBufferToCloudinary(videoBuffer, {
            resource_type: 'video',
            public_id: publicId,
            overwrite: true,
            format: 'mp4',
        });

        return {
            public_id: result.public_id,
            url:       result.secure_url,
            fileName:  `${sanitizedCardName}_${timestamp}.mp4`,
            fileSize:  videoBuffer.length,
        };
    }

    async saveAudioToCloudinary(audioBuffer, cardName, category) {
        if (!isCloudinaryEnabled()) throw new Error('Cloudinary not configured');

        const sanitizedCardName = String(cardName || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const sanitizedCategory = String(category || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const timestamp = Date.now();
        const publicId = `viralstatus/audios/${sanitizedCategory}/${sanitizedCardName}_${timestamp}`;

        const result = await uploadBufferToCloudinary(audioBuffer, {
            resource_type: 'video', // Cloudinary uses 'video' for audio files too
            public_id: publicId,
            overwrite: true,
            format: 'mp3',
        });

        return {
            public_id: result.public_id,
            url:       result.secure_url,
            fileName:  `${sanitizedCardName}_${timestamp}.mp3`,
            fileSize:  audioBuffer.length,
        };
    }

    async saveImageToCloudinary(imageBuffer, cardName, category, index) {
        if (!isCloudinaryEnabled()) throw new Error('Cloudinary not configured');

        const sanitizedCardName = String(cardName || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const sanitizedCategory = String(category || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const timestamp = Date.now();
        const publicId = `viralstatus/images/${sanitizedCategory}/${sanitizedCardName}_${timestamp}_${String(index + 1).padStart(2, '0')}`;

        const result = await uploadBufferToCloudinary(imageBuffer, {
            resource_type: 'image',
            public_id: publicId,
            overwrite: true,
            format: 'jpg',
        });

        return {
            public_id: result.public_id,
            url:       result.secure_url,
            fileName:  `${sanitizedCardName}_${String(index + 1).padStart(2, '0')}.jpg`,
            fileSize:  imageBuffer.length,
        };
    }

    // ─── Local Fallback ───────────────────────────────────────────────────────

    getPublicBaseUrl() {
        const envUrl =
            process.env.PUBLIC_BASE_URL ||
            process.env.BACKEND_URL ||
            process.env.BASE_URL;
        if (envUrl) return envUrl.replace(/\/+$/, '');
        return `http://localhost:${process.env.PORT || 4000}`;
    }

    async saveVideoToLocal(videoBuffer, cardName, category) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sanitizedCardName = String(cardName || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const sanitizedCategory = String(category || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const fileName = `${sanitizedCardName}_${timestamp}.mp4`;

        const absDir = path.resolve(__dirname, '..', 'uploads', 'videos', sanitizedCategory, sanitizedCardName, timestamp);
        fs.mkdirSync(absDir, { recursive: true });
        await fs.promises.writeFile(path.join(absDir, 'final_video.mp4'), videoBuffer);

        const url = `${this.getPublicBaseUrl()}/uploads/videos/${sanitizedCategory}/${sanitizedCardName}/${timestamp}/final_video.mp4`;
        return { key: null, public_id: null, url, fileName, fileSize: videoBuffer.length };
    }

    // ─── Job Status / Management ──────────────────────────────────────────────

    async getJobStatus(jobId) {
        try {
            const job = await VideoJob.getJobById(jobId);
            if (!job) throw new Error(`Job ${jobId} not found`);

            return {
                jobId:            job.jobId,
                status:           job.status,
                progress:         job.progress,
                cardName:         job.cardName,
                category:         job.category,
                videoUrl:         job.s3Url,   // stored as s3Url in model regardless of provider
                fileName:         job.fileName,
                duration:         job.duration,
                formattedDuration: job.formattedDuration,
                imageCount:       job.imageCount,
                sentenceCount:    job.sentenceCount,
                createdAt:        job.createdAt,
                startedAt:        job.startedAt,
                completedAt:      job.completedAt,
                error:            job.error
            };
        } catch (error) {
            console.error(`Error getting job status for ${jobId}:`, error);
            throw error;
        }
    }

    async getUserJobs(userId, limit = 10, skip = 0) {
        try {
            const jobs = await VideoJob.getUserJobs(userId, limit, skip);
            return jobs.map(job => ({
                jobId:            job.jobId,
                status:           job.status,
                progress:         job.progress,
                cardName:         job.cardName,
                category:         job.category,
                videoUrl:         job.s3Url,
                fileName:         job.fileName,
                duration:         job.duration,
                formattedDuration: job.formattedDuration,
                imageCount:       job.imageCount,
                sentenceCount:    job.sentenceCount,
                createdAt:        job.createdAt,
                completedAt:      job.completedAt,
                error:            job.error
            }));
        } catch (error) {
            console.error(`Error getting user jobs for ${userId}:`, error);
            throw error;
        }
    }

    async cancelJob(jobId) {
        try {
            const job = await VideoJob.getJobById(jobId);
            if (!job) throw new Error(`Job ${jobId} not found`);
            if (job.status === 'pending') {
                job.status = 'failed';
                job.error = { message: 'Job cancelled by user', timestamp: new Date() };
                job.completedAt = new Date();
                await job.save();
                return true;
            }
            return false;
        } catch (error) {
            console.error(`Error cancelling job ${jobId}:`, error);
            throw error;
        }
    }

    getSystemStatus() {
        return {
            activeJobs:       this.activeJobs.size,
            maxConcurrentJobs: this.maxConcurrentJobs,
            availableSlots:   this.maxConcurrentJobs - this.activeJobs.size,
            activeJobIds:     Array.from(this.activeJobs.keys()),
            storageProvider:  isCloudinaryEnabled() ? 'cloudinary' : 'local'
        };
    }

    async cleanupOldJobs() {
        try {
            const result = await VideoJob.cleanupOldJobs();
            console.log(`Cleaned up ${result.deletedCount} old video jobs`);
            return result.deletedCount;
        } catch (error) {
            console.error('Error cleaning up old jobs:', error);
            throw error;
        }
    }
}

const videoJobService = new VideoJobService();
module.exports = videoJobService;
