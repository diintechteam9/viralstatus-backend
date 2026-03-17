const VideoJob = require('../models/VideoJob');
const { generateFinalVideoAsync } = require('../controllers/aivideogen/generatefinalvideocontroller');
const fs = require('fs');
const path = require('path');

class VideoJobService {
    constructor() {
        this.activeJobs = new Map(); // Track active jobs in memory
        this.maxConcurrentJobs = 3; // Limit concurrent video generations
    }

    /**
     * Create a new video generation job
     */
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

    /**
     * Start processing a video job
     */
    async startJob(jobId, requestData) {
        try {
            const job = await VideoJob.getJobById(jobId);
            if (!job) {
                throw new Error(`Job ${jobId} not found`);
            }

            if (job.status !== 'pending') {
                throw new Error(`Job ${jobId} is not in pending status`);
            }

            // Check if we can start more jobs
            if (this.activeJobs.size >= this.maxConcurrentJobs) {
                throw new Error('Maximum concurrent jobs reached. Please try again later.');
            }

            // Mark job as processing
            await job.updateProgress(0, 'processing');
            this.activeJobs.set(jobId, job);

            console.log(`Starting video job: ${jobId}`);

            // Start video generation in background
            this.processVideoAsync(jobId, requestData);

            return job;
        } catch (error) {
            console.error(`Error starting job ${jobId}:`, error);
            throw error;
        }
    }

    /**
     * Process video generation asynchronously
     */
    async processVideoAsync(jobId, requestData) {
        try {
            const job = await VideoJob.getJobById(jobId);
            if (!job) {
                console.error(`Job ${jobId} not found during processing`);
                return;
            }

            console.log(`Processing video job: ${jobId}`);

            // Update progress: Starting
            await job.updateProgress(10, 'processing');

            // If audio base64 is provided, upload to S3 and persist audio metadata on the job
            if (requestData.audio) {
                try {
                    const audioBuffer = Buffer.from(requestData.audio, 'base64');
                    const audioS3 = await this.saveAudioToS3(
                        audioBuffer,
                        job.cardName,
                        job.category
                    );
                    job.audioS3Key = audioS3.key;
                    job.audioS3Url = audioS3.url;
                    job.audioFileName = audioS3.fileName;
                    job.audioFileSize = audioS3.fileSize;
                    job.audioContentType = 'audio/mpeg';
                    await job.save();
                } catch (e) {
                    console.warn(`Job ${jobId}: failed to upload audio to S3, continuing`, e.message);
                }
            }

            // Save each input image to S3 in sequence (optional but requested)
            if (Array.isArray(requestData.images) && requestData.images.length > 0) {
                try {
                    const savedAssets = [];
                    for (let i = 0; i < requestData.images.length; i++) {
                        const raw = requestData.images[i];
                        const base64 = typeof raw === 'string' ? raw : raw.image;
                        if (!base64 || typeof base64 !== 'string') continue;
                        const buffer = Buffer.from(base64, 'base64');
                        const asset = await this.saveImageToS3(buffer, job.cardName, job.category, i);
                        savedAssets.push({ index: i, s3Key: asset.key, s3Url: asset.url, fileName: asset.fileName, fileSize: asset.fileSize });
                    }
                    job.imageAssets = savedAssets;
                    await job.save();
                } catch (e) {
                    console.warn(`Job ${jobId}: failed to upload images to S3, continuing`, e.message);
                }
            }

            // Generate video using the existing controller
            const result = await generateFinalVideoAsync(requestData, {
                onProgress: async (progress, message) => {
                    const job = await VideoJob.getJobById(jobId);
                    if (job) {
                        // Map progress from 10-90% (leaving 10% for final steps)
                        const mappedProgress = 10 + (progress * 0.8);
                        await job.updateProgress(mappedProgress, 'processing');
                        console.log(`Job ${jobId} progress: ${mappedProgress.toFixed(1)}% - ${message}`);
                    }
                }
            });

            // Update progress: Saving to S3
            await job.updateProgress(90, 'processing');

            // Save video to S3 with organized structure (fallback to local on any cloud error)
            let videoStore = null;
            try {
                videoStore = await this.saveVideoToS3(result.video, job.cardName, job.category);
            } catch (storeErr) {
                console.warn(`Job ${jobId}: failed to upload video to S3, falling back to local storage`, storeErr?.message || storeErr);
                videoStore = await this.saveVideoToLocal(result.video, job.cardName, job.category);
            }

            // If this job is linked to a card, delete previous S3 video for that card and update the card doc
            if (job.cardId) {
                try {
                    const VideoCard = require('../models/aivideogen');
                    const existing = await VideoCard.findById(job.cardId);
                    if (existing) {
                        // Delete old S3 object if present
                        if (existing.latestVideoS3Key) {
                            try {
                                const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
                                const { s3, BUCKET_NAME } = require('../config/s3');
                                await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: existing.latestVideoS3Key }));
                            } catch (delErr) {
                                console.warn(`Job ${jobId}: failed to delete old S3 video`, delErr.message);
                            }
                        }

                        // Update card with latest video info
                        existing.latestVideoS3Key = videoStore.key || undefined;
                        existing.latestVideoUrl = videoStore.url;
                        existing.latestVideoFileName = videoStore.fileName;
                        existing.latestVideoFileSize = videoStore.fileSize;
                        existing.latestVideoDuration = result.duration;
                        existing.latestVideoCreatedAt = new Date();
                        existing.updatedAt = new Date();
                        await existing.save();
                    }
                } catch (cardErr) {
                    console.warn(`Job ${jobId}: failed to update video card metadata`, cardErr.message);
                }
            }

            // Complete the job
            await job.complete({
                s3Key: videoStore.key,
                s3Url: videoStore.url,
                fileName: videoStore.fileName,
                fileSize: videoStore.fileSize,
                duration: result.duration,
                audioDuration: result.audioDuration,
                imageCount: result.imageCount,
                sentenceCount: result.sentenceCount
            });

            console.log(`Video job completed: ${jobId}, URL: ${videoStore.url}`);

        } catch (error) {
            console.error(`Error processing video job ${jobId}:`, error);
            const job = await VideoJob.getJobById(jobId);
            if (job) {
                await job.setError(error);
            }
        } finally {
            // Remove from active jobs
            this.activeJobs.delete(jobId);
        }
    }

    /**
     * Build the base public URL for returning assets.
     * Prefer env when deployed; fallback to localhost for dev.
     */
    getPublicBaseUrl() {
        const envUrl =
            process.env.PUBLIC_BASE_URL ||
            process.env.BACKEND_URL ||
            process.env.API_BASE_URL ||
            process.env.BASE_URL;
        if (envUrl && typeof envUrl === 'string') return envUrl.replace(/\/+$/, '');
        const port = process.env.PORT || 4000;
        return `http://localhost:${port}`;
    }

    /**
     * Save video to local uploads folder and return a public URL.
     * This is the production-safe fallback if S3/Cloud storage fails.
     */
    async saveVideoToLocal(videoBuffer, cardName, category) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sanitizedCardName = String(cardName || 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const sanitizedCategory = String(category || 'general').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const fileName = `${sanitizedCardName}_${timestamp}.mp4`;

        const relDir = path.posix.join('uploads', 'videos', sanitizedCategory, sanitizedCardName, timestamp);
        const absDir = path.resolve(__dirname, '..', relDir);
        fs.mkdirSync(absDir, { recursive: true });

        const absPath = path.join(absDir, 'final_video.mp4');
        await fs.promises.writeFile(absPath, videoBuffer);

        // Express serves /uploads from <backend>/uploads, so strip leading "uploads/"
        const publicPath = `/uploads/videos/${sanitizedCategory}/${sanitizedCardName}/${timestamp}/final_video.mp4`;
        const url = `${this.getPublicBaseUrl()}${publicPath}`;

        return {
            key: null,
            url,
            fileName,
            fileSize: videoBuffer.length
        };
    }

    /**
     * Save video to S3 with organized structure
     */
    async saveVideoToS3(videoBuffer, cardName, category) {
        try {
            const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
            const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
            const { s3, BUCKET_NAME } = require('../config/s3');

            // Create organized S3 key structure
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const sanitizedCardName = cardName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const sanitizedCategory = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            
            const s3Key = `videos/${sanitizedCategory}/${sanitizedCardName}/${timestamp}/final_video.mp4`;
            const fileName = `${sanitizedCardName}_${timestamp}.mp4`;

            // Upload to S3 (no ACLs for private buckets)
            const putCmd = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Body: videoBuffer,
                ContentType: 'video/mp4',
                Metadata: {
                    'card-name': cardName,
                    'category': category,
                    'generated-at': new Date().toISOString()
                }
            });

            await s3.send(putCmd);

            // Optionally generate a short-lived presigned URL for immediate playback
            const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
            const presignedUrl = await getSignedUrl(s3, getCmd, { expiresIn: 604800 }); //604800 1 week

            return {
                key: s3Key,
                url: presignedUrl,
                fileName: fileName,
                fileSize: videoBuffer.length
            };

        } catch (error) {
            // Avoid dumping full AWS exception objects (can include sensitive metadata).
            console.error('Error saving video to S3:', error?.message || error);
            throw error;
        }
    }

    /**
     * Save audio to S3 with organized structure
     */
    async saveAudioToS3(audioBuffer, cardName, category) {
        try {
            const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
            const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
            const { s3, BUCKET_NAME } = require('../config/s3');

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const sanitizedCardName = cardName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const sanitizedCategory = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

            const s3Key = `audios/${sanitizedCategory}/${sanitizedCardName}/${timestamp}/narration.mp3`;
            const fileName = `${sanitizedCardName}_${timestamp}.mp3`;

            const putCmd = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Body: audioBuffer,
                ContentType: 'audio/mpeg',
                Metadata: {
                    'card-name': cardName,
                    'category': category,
                    'generated-at': new Date().toISOString()
                }
            });

            await s3.send(putCmd);

            const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
            const presignedUrl = await getSignedUrl(s3, getCmd, { expiresIn: 60 * 60 });

            return {
                key: s3Key,
                url: presignedUrl,
                fileName,
                fileSize: audioBuffer.length
            };
        } catch (error) {
            console.error('Error saving audio to S3:', error);
            throw error;
        }
    }

    /**
     * Save image to S3 with deterministic sequence key
     */
    async saveImageToS3(imageBuffer, cardName, category, index) {
        try {
            const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
            const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
            const { s3, BUCKET_NAME } = require('../config/s3');

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const sanitizedCardName = cardName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const sanitizedCategory = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

            const s3Key = `images/${sanitizedCategory}/${sanitizedCardName}/${timestamp}/image_${String(index + 1).padStart(2, '0')}.jpg`;
            const fileName = `${sanitizedCardName}_${String(index + 1).padStart(2, '0')}.jpg`;

            const putCmd = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Body: imageBuffer,
                ContentType: 'image/jpeg',
                Metadata: {
                    'card-name': cardName,
                    'category': category,
                    'sequence-index': String(index)
                }
            });

            await s3.send(putCmd);

            const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
            const presignedUrl = await getSignedUrl(s3, getCmd, { expiresIn: 60 * 60 });

            return { key: s3Key, url: presignedUrl, fileName, fileSize: imageBuffer.length };
        } catch (error) {
            console.error('Error saving image to S3:', error);
            throw error;
        }
    }

    /**
     * Get job status
     */
    async getJobStatus(jobId) {
        try {
            const job = await VideoJob.getJobById(jobId);
            if (!job) {
                throw new Error(`Job ${jobId} not found`);
            }

            // For private buckets, if job is completed and we have a key but no URL, return a fresh presigned URL
            let videoUrl = job.s3Url;
            if (job.status === 'completed' && job.s3Key && !videoUrl) {
                try {
                    const { GetObjectCommand } = require('@aws-sdk/client-s3');
                    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
                    const { s3, BUCKET_NAME } = require('../config/s3');
                    const cmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: job.s3Key });
                    videoUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 * 60 });
                } catch (e) {
                    // leave videoUrl undefined if presign fails
                }
            }

            return {
                jobId: job.jobId,
                status: job.status,
                progress: job.progress,
                cardName: job.cardName,
                category: job.category,
                videoUrl,
                fileName: job.fileName,
                duration: job.duration,
                formattedDuration: job.formattedDuration,
                imageCount: job.imageCount,
                sentenceCount: job.sentenceCount,
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                error: job.error
            };
        } catch (error) {
            console.error(`Error getting job status for ${jobId}:`, error);
            throw error;
        }
    }

    /**
     * Get user's video jobs
     */
    async getUserJobs(userId, limit = 10, skip = 0) {
        try {
            const jobs = await VideoJob.getUserJobs(userId, limit, skip);
            return jobs.map(job => ({
                jobId: job.jobId,
                status: job.status,
                progress: job.progress,
                cardName: job.cardName,
                category: job.category,
                videoUrl: job.s3Url,
                fileName: job.fileName,
                duration: job.duration,
                formattedDuration: job.formattedDuration,
                imageCount: job.imageCount,
                sentenceCount: job.sentenceCount,
                createdAt: job.createdAt,
                completedAt: job.completedAt,
                error: job.error
            }));
        } catch (error) {
            console.error(`Error getting user jobs for ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Cancel a job (if it's still pending)
     */
    async cancelJob(jobId) {
        try {
            const job = await VideoJob.getJobById(jobId);
            if (!job) {
                throw new Error(`Job ${jobId} not found`);
            }

            if (job.status === 'pending') {
                job.status = 'failed';
                job.error = {
                    message: 'Job cancelled by user',
                    timestamp: new Date()
                };
                job.completedAt = new Date();
                await job.save();
                return true;
            }

            return false; // Job cannot be cancelled
        } catch (error) {
            console.error(`Error cancelling job ${jobId}:`, error);
            throw error;
        }
    }

    /**
     * Get system status
     */
    getSystemStatus() {
        return {
            activeJobs: this.activeJobs.size,
            maxConcurrentJobs: this.maxConcurrentJobs,
            availableSlots: this.maxConcurrentJobs - this.activeJobs.size,
            activeJobIds: Array.from(this.activeJobs.keys())
        };
    }

    /**
     * Cleanup old jobs (call this periodically)
     */
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

// Create singleton instance
const videoJobService = new VideoJobService();

module.exports = videoJobService;
