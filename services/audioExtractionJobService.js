const AudioExtractionJob = require('../models/AudioExtractionJob');
const { PutObjectCommand, GetObjectCommand, ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3, BUCKET_NAME } = require('../config/s3');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeStatic = require('ffprobe-static');

// Set FFmpeg and FFprobe paths
try {
    if (ffmpegInstaller && ffmpegInstaller.path) {
        ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    }
    if (ffprobeStatic && ffprobeStatic.path) {
        ffmpeg.setFfprobePath(ffprobeStatic.path);
    }
} catch (err) {
    console.error('❌ Audio FFmpeg setup failed:', err.message);
}

class AudioExtractionJobService {
    constructor() {
        this.activeJobs = new Map(); // Track active jobs in memory
        this.maxConcurrentJobs = 3; // Limit concurrent audio extractions
        this.progressUpdateTimers = new Map(); // Track progress update timers
    }

    /**
     * Debounced progress update to prevent parallel save conflicts
     */
    debouncedProgressUpdate(jobId, progress, status) {
        // Clear existing timer if any
        if (this.progressUpdateTimers.has(jobId)) {
            clearTimeout(this.progressUpdateTimers.get(jobId));
        }

        // Set new timer
        const timer = setTimeout(async () => {
            try {
                const job = await AudioExtractionJob.getJobById(jobId);
                if (job) {
                    // Do not allow regressions once job is terminal
                    if (job.status === 'completed' || job.status === 'failed') {
                        return;
                    }
                    // Only update progress; keep status as processing
                    await job.updateProgress(progress, status);
                }
            } catch (error) {
                console.warn(`Failed to update progress for job ${jobId}:`, error.message);
            } finally {
                this.progressUpdateTimers.delete(jobId);
            }
        }, 1000); // Update every 1 second max

        this.progressUpdateTimers.set(jobId, timer);
    }

    /**
     * Create a new audio extraction job
     */
    async createJob(jobData) {
        try {
            const job = await AudioExtractionJob.createJob(jobData);
            console.log(`Created audio extraction job: ${job.jobId}`);
            return job;
        } catch (error) {
            console.error('Error creating audio extraction job:', error);
            throw error;
        }
    }

    /**
     * Start processing an audio extraction job
     */
    async startJob(jobId) {
        try {
            const job = await AudioExtractionJob.getJobById(jobId);
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

            console.log(`Starting audio extraction job: ${jobId}`);

            // Start audio extraction in background
            this.processAudioExtractionAsync(jobId);

            return job;
        } catch (error) {
            console.error(`Error starting job ${jobId}:`, error);
            throw error;
        }
    }

    /**
     * Process audio extraction asynchronously
     */
    async processAudioExtractionAsync(jobId) {
        try {
            const job = await AudioExtractionJob.getJobById(jobId);
            if (!job) {
                console.error(`Job ${jobId} not found during processing`);
                return;
            }

            console.log(`Processing audio extraction job: ${jobId}`);

            // Update progress: Starting
            await job.updateProgress(10, 'processing');

            // Extract audio from video
            const audioBuffer = await this.extractAudioFromVideo(job);

            // Update progress: Saving to S3
            await job.updateProgress(90, 'processing');

            // Save to S3
            const uploaded = await this.saveAudioToS3(audioBuffer, job.jobId);

            // Clear any pending progress timer before completing to avoid race downgrades
            try {
                if (this.progressUpdateTimers.has(jobId)) {
                    clearTimeout(this.progressUpdateTimers.get(jobId));
                    this.progressUpdateTimers.delete(jobId);
                }
            } catch (_) {}

            // Complete the job
            await job.complete({
                s3Key: uploaded.key,
                s3Url: uploaded.url,
                fileName: uploaded.fileName,
                fileSize: uploaded.fileSize,
                duration: uploaded.duration,
                contentType: 'audio/mpeg'
            });

            console.log(`Audio extraction job completed: ${jobId}, uploaded audio: ${uploaded ? 'yes' : 'no'}, url: ${uploaded?.url || 'none'}`);

            // Cleanup job working directory after successful completion
            try {
                this.cleanupJobDirectory(job);
            } catch (cleanupErr) {
                console.warn(`[Audio][Job] ${jobId} cleanup warning:`, cleanupErr?.message || cleanupErr);
            }

        } catch (error) {
            console.error(`Error processing audio extraction job ${jobId}:`, error);
            const job = await AudioExtractionJob.getJobById(jobId);
            if (job) {
                await job.setError(error);
            }
        } finally {
            // Remove from active jobs and clear progress timer
            this.activeJobs.delete(jobId);
            if (this.progressUpdateTimers.has(jobId)) {
                clearTimeout(this.progressUpdateTimers.get(jobId));
                this.progressUpdateTimers.delete(jobId);
            }
        }
    }

    /**
     * Extract audio from video file using FFmpeg
     */
    async extractAudioFromVideo(job) {
        return new Promise((resolve, reject) => {
            const inputPath = job.originalVideoFile.path;
            if (!inputPath || !fs.existsSync(inputPath)) {
                return reject(new Error(`Input video not found at ${inputPath || '(empty path)'}`));
            }

            console.log('[Audio][Job]', job.jobId, 'extracting audio from:', inputPath);
            console.log('[Audio][Job]', job.jobId, 'FFmpeg path:', ffmpegInstaller?.path);
            console.log('[Audio][Job]', job.jobId, 'FFprobe path:', ffprobeStatic?.path);

            // Create output path for temporary audio file
            const outputFileName = `audio_${job.jobId}_${Date.now()}.mp3`;
            const outputPath = path.join('temp', 'audio', outputFileName);

            // Ensure temp/audio directory exists
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });

            const chunks = [];
            let totalDuration = 0;

            ffmpeg(inputPath)
                .noVideo()
                .audioCodec('libmp3lame')
                .audioBitrate('192k')
                .on('start', (commandLine) => {
                    console.log('[Audio][Job]', job.jobId, 'FFmpeg started:', commandLine);
                })
                .on('progress', (progress) => {
                    const percent = Math.min(90, 10 + (progress.percent || 0) * 0.8); // 10-90% range
                    this.debouncedProgressUpdate(job.jobId, percent, 'processing');
                    
                    if (progress.timemark) {
                        totalDuration = this.parseDuration(progress.timemark);
                    }
                })
                .on('error', (err) => {
                    console.error('[Audio][Job]', job.jobId, 'FFmpeg error details:', {
                        message: err.message,
                        stack: err.stack,
                        code: err.code,
                        signal: err.signal
                    });
                    this.safeCleanup([inputPath, outputPath]);
                    reject(new Error(`Audio extraction failed: ${err.message}`));
                })
                .on('end', () => {
                    console.log('[Audio][Job]', job.jobId, 'FFmpeg completed, reading audio file...');
                    
                    try {
                        if (!fs.existsSync(outputPath)) {
                            throw new Error('Audio file was not created');
                        }

                        const audioBuffer = fs.readFileSync(outputPath);
                        const stats = fs.statSync(outputPath);
                        
                        console.log('[Audio][Job]', job.jobId, 'Audio extracted successfully:', {
                            size: audioBuffer.length,
                            fileSize: stats.size
                        });

                        // Clean up temporary file
                        this.safeCleanup([outputPath]);

                        resolve(audioBuffer);
                    } catch (error) {
                        this.safeCleanup([outputPath]);
                        reject(new Error(`Failed to read extracted audio: ${error.message}`));
                    }
                })
                .save(outputPath);
        });
    }

    /**
     * Parse FFmpeg duration string to seconds
     */
    parseDuration(timemark) {
        if (!timemark) return 0;
        const parts = timemark.split(':');
        if (parts.length !== 3) return 0;
        
        const hours = parseInt(parts[0]) || 0;
        const minutes = parseInt(parts[1]) || 0;
        const seconds = parseFloat(parts[2]) || 0;
        
        return hours * 3600 + minutes * 60 + seconds;
    }

    /**
     * Save audio to S3 with organized structure
     */
    async saveAudioToS3(audioBuffer, jobId) {
        try {
            // Create organized S3 key structure for audio extraction
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const s3Key = `audio-extraction/${jobId}/${timestamp}/audio.mp3`;
            const fileName = `audio_${timestamp}.mp3`;

            // Upload to S3
            const putCmd = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Body: audioBuffer,
                ContentType: 'audio/mpeg',
                Metadata: {
                    'job-id': jobId,
                    'generated-at': new Date().toISOString(),
                    'type': 'audio-extraction'
                }
            });

            await s3.send(putCmd);

            // Generate a presigned URL for immediate playback
            const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
            const presignedUrl = await getSignedUrl(s3, getCmd, { expiresIn: 604800 }); // 1 week

            return {
                key: s3Key,
                url: presignedUrl,
                fileName: fileName,
                fileSize: audioBuffer.length,
                duration: 0 // Will be updated if we can determine duration
            };

        } catch (error) {
            console.error('Error saving audio to S3:', error);
            throw error;
        }
    }

    /**
     * Get job status
     */
    async getJobStatus(jobId) {
        try {
            return await AudioExtractionJob.getJobById(jobId);
        } catch (error) {
            console.error(`Error getting job status for ${jobId}:`, error);
            throw error;
        }
    }

    /**
     * Reconcile job state by checking S3. If audio exists but job not marked completed,
     * promote it to completed and ensure a fresh presigned URL is set.
     */
    async reconcileIfCompleted(jobId) {
        try {
            const job = await AudioExtractionJob.getJobById(jobId);
            if (!job) return null;

            if (job.status === 'completed') return job;

            // If we already have an S3 key, verify it exists; else try to find by prefix
            let s3Key = job.audioS3Key;
            if (!s3Key) {
                const prefix = `audio-extraction/${jobId}/`;
                const listCmd = new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: prefix });
                const listed = await s3.send(listCmd);
                const candidates = (listed.Contents || []).sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
                const latest = candidates.find(obj => obj.Key && obj.Key.endsWith('/audio.mp3')) || candidates[0];
                if (latest && latest.Key) s3Key = latest.Key;
            }

            if (!s3Key) return job; // Nothing to reconcile

            // Verify object exists
            try {
                await s3.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }));
            } catch (e) {
                // Object not found, nothing to do
                return job;
            }

            // Generate presigned URL
            const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
            const presignedUrl = await getSignedUrl(s3, getCmd, { expiresIn: 604800 });

            // Promote to completed (idempotent)
            await job.complete({
                s3Key,
                s3Url: presignedUrl,
                fileName: path.basename(s3Key) || 'audio.mp3',
                fileSize: job.audioFileSize || 0,
                duration: job.audioDuration || 0,
                contentType: 'audio/mpeg'
            });

            return await AudioExtractionJob.getJobById(jobId);
        } catch (error) {
            console.warn(`[Audio][Job] ${jobId} reconciliation failed:`, error?.message || error);
            return await AudioExtractionJob.getJobById(jobId);
        }
    }

    /**
     * Get jobs by user ID
     */
    async getJobsByUserId(userId, limit = 50) {
        try {
            return await AudioExtractionJob.getJobsByUserId(userId, limit);
        } catch (error) {
            console.error(`Error getting jobs for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Clean up old jobs (optional maintenance method)
     */
    async cleanupOldJobs(daysOld = 7) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            
            const result = await AudioExtractionJob.deleteMany({
                createdAt: { $lt: cutoffDate },
                status: { $in: ['completed', 'failed'] }
            });
            
            console.log(`Cleaned up ${result.deletedCount} old audio extraction jobs`);
            return result.deletedCount;
        } catch (error) {
            console.error('Error cleaning up old jobs:', error);
            throw error;
        }
    }

    /**
     * Clean up all progress update timers (for graceful shutdown)
     */
    cleanupTimers() {
        for (const [jobId, timer] of this.progressUpdateTimers) {
            clearTimeout(timer);
        }
        this.progressUpdateTimers.clear();
        console.log('Cleaned up all progress update timers');
    }

    /**
     * Remove the temporary working directory for a completed job
     */
    cleanupJobDirectory(job) {
        try {
            const inputPath = job?.originalVideoFile?.path;
            if (!inputPath) return;
            
            const jobDir = path.dirname(inputPath);
            // Extra safety: ensure this is inside temp/jobs/<jobId>
            const expectedSegment = path.join('temp', 'jobs', job.jobId);
            const normalizedJobDir = path.normalize(jobDir);
            const normalizedExpected = path.normalize(expectedSegment);
            
            if (!normalizedJobDir.endsWith(path.sep + job.jobId) && !normalizedJobDir.includes(normalizedExpected)) {
                // Do not delete unexpected paths
                console.warn(`[Audio][Job] ${job.jobId} cleanup skipped, unexpected dir:`, jobDir);
                return;
            }
            
            if (fs.existsSync(jobDir)) {
                fs.rmSync(jobDir, { recursive: true, force: true });
                console.log(`[Audio][Job] ${job.jobId} cleaned job dir:`, jobDir);
            }
        } catch (err) {
            console.warn(`[Audio][Job] ${job?.jobId} cleanup failed:`, err?.message || err);
        }
    }

    /**
     * Safe cleanup of files
     */
    safeCleanup(paths) {
        for (const filePath of paths) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (err) {
                console.warn(`Failed to cleanup file ${filePath}:`, err.message);
            }
        }
    }
}

module.exports = new AudioExtractionJobService();
