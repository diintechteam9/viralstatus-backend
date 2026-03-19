const VideoToReelsJob = require('../models/VideoToReelsJob');
const { generateReel, generateReelSegments } = require('../controllers/videoToReelsController');
const { generateVideoWithWordSrt } = require('../controllers/videosubtitlecontroller');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { r2Client: s3, BUCKET_NAME } = require('../config/r2');
const fs = require('fs');
const path = require('path');

class VideoToReelsJobService {
    constructor() {
        this.activeJobs = new Map(); // Track active jobs in memory
        this.maxConcurrentJobs = 2; // Limit concurrent video-to-reels generations
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
                const job = await VideoToReelsJob.getJobById(jobId);
                if (job) {
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
     * Create a new video-to-reels generation job
     */
    async createJob(jobData) {
        try {
            const job = await VideoToReelsJob.createJob(jobData);
            console.log(`Created video-to-reels job: ${job.jobId}`);
            return job;
        } catch (error) {
            console.error('Error creating video-to-reels job:', error);
            throw error;
        }
    }

    /**
     * Start processing a video-to-reels job
     */
    async startJob(jobId, requestData) {
        try {
            const job = await VideoToReelsJob.getJobById(jobId);
            if (!job) {
                throw new Error(`Job ${jobId} not found`);
            }
            if (job.status !== 'pending') {
                throw new Error(`Job ${jobId} is not in pending status`);
            }
            if (this.activeJobs.size >= this.maxConcurrentJobs) {
                throw new Error('Maximum concurrent jobs reached. Please try again later.');
            }
            await job.updateProgress(0, 'processing');
            this.activeJobs.set(jobId, job);
            console.log(`Starting video-to-reels job: ${jobId}`);
            this.processVideoToReelsAsync(jobId, requestData);
            return job;
        } catch (error) {
            console.error(`Error starting job ${jobId}:`, error);
            throw error;
        }
    }

  /**
   * Start processing a subtitles job
   */
  async startSubtitleJob(jobId, requestData) {
    try {
      const job = await VideoToReelsJob.getJobById(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }
      if (job.status !== 'pending') {
        throw new Error(`Job ${jobId} is not in pending status`);
      }
      if (this.activeJobs.size >= this.maxConcurrentJobs) {
        throw new Error('Maximum concurrent jobs reached. Please try again later.');
      }
      await job.updateProgress(0, 'processing');
      this.activeJobs.set(jobId, job);
      this.processSubtitlesAsync(jobId, requestData);
      return job;
    } catch (error) {
      console.error(`Error starting subtitles job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Process subtitles generation asynchronously
   */
  async processSubtitlesAsync(jobId, requestData) {
    try {
      const job = await VideoToReelsJob.getJobById(jobId);
      if (!job) { console.error(`Job ${jobId} not found during processing`); return; }
      await job.updateProgress(10, 'processing');
      const buffer = await this.generateSubtitledVideoBuffer(job, requestData);
      await job.updateProgress(90, 'processing');
      const uploaded = await this.saveVideoToS3(buffer, jobId);
      await job.complete({
        url: uploaded?.url || null,
        key: uploaded?.key || null,
        fileName: uploaded?.fileName || null,
        fileSize: uploaded?.fileSize || null,
        duration: 0,
        videos: uploaded ? [{ ...uploaded, index: 1 }] : []
      });
      try { this.cleanupJobDirectory(job); } catch (_) {}
    } catch (error) {
      console.error(`Error processing subtitles job ${jobId}:`, error);
      const job = await VideoToReelsJob.getJobById(jobId);
      if (job) { await job.setError(error); }
    } finally {
      this.activeJobs.delete(jobId);
      if (this.progressUpdateTimers.has(jobId)) {
        clearTimeout(this.progressUpdateTimers.get(jobId));
        this.progressUpdateTimers.delete(jobId);
      }
    }
  }

  /**
   * Generate buffer by running the subtitles overlay pipeline
   */
  async generateSubtitledVideoBuffer(job, requestData) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let chunkCount = 0;
      const inputPath = job.originalVideoFile?.path;
      if (!inputPath || !fs.existsSync(inputPath)) {
        return reject(new Error(`Input video not found at ${inputPath || '(empty path)'}`));
      }
      const mockReq = {
        file: {
          path: inputPath,
          originalname: job.originalVideoFile.originalName,
          size: job.originalVideoFile.size,
          mimetype: job.originalVideoFile.mimetype
        },
        body: {
          wordSrt: job.wordSrt || job.srt,
          fontKey: job.fontKey,
          textColor: job.textColor,
          backgroundColor: job.backgroundColor,
          boxOpacity: typeof job.boxOpacity === 'number' ? job.boxOpacity : undefined,
          textPosition: job.textPosition
        }
      };
      const mockRes = {
        setHeader: () => {},
        on: () => {},
        once: () => {},
        emit: () => {},
        removeListener: () => {},
        write: (chunk) => {
          chunks.push(chunk);
          chunkCount++;
          const progress = Math.min(80, 10 + (chunkCount * 0.7));
          this.debouncedProgressUpdate(job.jobId, progress, 'processing');
          return true;
        },
        end: () => {
          const buf = Buffer.concat(chunks);
          resolve(buf);
        },
        status: (code) => ({ json: (data) => reject(new Error((data?.error || `Subtitle generation failed (${code})`) + (data?.details ? `: ${data.details}` : ''))) }),
        json: (data) => reject(new Error((data?.error || 'Subtitle generation failed') + (data?.details ? `: ${data.details}` : '')))
      };
      generateVideoWithWordSrt(mockReq, mockRes).catch(reject);
    });
  }

    /**
     * Process video-to-reels generation asynchronously
     */
    async processVideoToReelsAsync(jobId, requestData) {
        try {
            const job = await VideoToReelsJob.getJobById(jobId);
            if (!job) {
                console.error(`Job ${jobId} not found during processing`);
                return;
            }

            console.log(`Processing video-to-reels job: ${jobId}`);

            // Update progress: Starting
            await job.updateProgress(10, 'processing');

            // Generate single final reel buffer with overlays and outro via controller path
            const finalBuffer = await this.generateReelBuffer(job, requestData);

            // Update progress: Saving to S3
            await job.updateProgress(90, 'processing');

            // Save to S3 (single file)
            const uploaded = await this.saveVideoToS3(finalBuffer, job.jobId);

            // Complete the job with primary video (videos array optional)
            await job.complete({
                url: uploaded?.url || null,
                key: uploaded?.key || null,
                fileName: uploaded?.fileName || null,
                fileSize: uploaded?.fileSize || null,
                duration: 0,
                videos: uploaded ? [{ ...uploaded, index: 1 }] : []
            });

            console.log(`Video-to-reels job completed: ${jobId}, uploaded video: ${uploaded ? 'yes' : 'no'}, url: ${uploaded?.url || 'none'}`);

            // Cleanup job working directory after successful completion
            try {
                this.cleanupJobDirectory(job);
            } catch (cleanupErr) {
                console.warn(`[VTR][Job] ${jobId} cleanup warning:`, cleanupErr?.message || cleanupErr);
            }

        } catch (error) {
            console.error(`Error processing video-to-reels job ${jobId}:`, error);
            const job = await VideoToReelsJob.getJobById(jobId);
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
     * Start processing a video-to-reels segments job
     */
    async startSegmentsJob(jobId, requestData) {
        try {
            const job = await VideoToReelsJob.getJobById(jobId);
            if (!job) {
                throw new Error(`Job ${jobId} not found`);
            }
            if (job.status !== 'pending') {
                throw new Error(`Job ${jobId} is not in pending status`);
            }
            if (this.activeJobs.size >= this.maxConcurrentJobs) {
                throw new Error('Maximum concurrent jobs reached. Please try again later.');
            }
            await job.updateProgress(0, 'processing');
            this.activeJobs.set(jobId, job);
            console.log(`Starting video-to-reels segments job: ${jobId}`);
            this.processSegmentsAsync(jobId, requestData);
            return job;
        } catch (error) {
            console.error(`Error starting segments job ${jobId}:`, error);
            throw error;
        }
    }

    /**
     * Process segments generation asynchronously
     */
    async processSegmentsAsync(jobId, requestData) {
        try {
            const job = await VideoToReelsJob.getJobById(jobId);
            if (!job) {
                console.error(`Job ${jobId} not found during segments processing`);
                return;
            }
            console.log(`Processing segments job: ${jobId}`);
            await job.updateProgress(10, 'processing');

            // Generate up to 3 segments using controller helper
            const { buffers } = await this.generateSegmentFiles(job, requestData);
            await job.updateProgress(70, 'processing');

            // Upload each buffer to S3
            const uploadedList = await this.saveMultipleVideosToS3(buffers, job.jobId);
            await job.updateProgress(95, 'processing');

            // Complete job with list of videos
            await job.complete({
                url: uploadedList?.[0]?.url || null,
                key: uploadedList?.[0]?.key || null,
                fileName: uploadedList?.[0]?.fileName || null,
                fileSize: uploadedList?.[0]?.fileSize || null,
                duration: 0,
                videos: uploadedList
            });

            console.log(`Segments job completed: ${jobId}, uploaded ${uploadedList.length} videos`);
            try { this.cleanupJobDirectory(job); } catch (_) {}
        } catch (error) {
            console.error(`Error processing segments job ${jobId}:`, error);
            const job = await VideoToReelsJob.getJobById(jobId);
            if (job) {
                await job.setError(error);
            }
        } finally {
            this.activeJobs.delete(jobId);
            if (this.progressUpdateTimers.has(jobId)) {
                clearTimeout(this.progressUpdateTimers.get(jobId));
                this.progressUpdateTimers.delete(jobId);
            }
        }
    }

    /**
     * Generate reel buffer using the existing generateReel function
     */
    async generateReelBuffer(job, requestData) {
        return new Promise((resolve, reject) => {
            const chunks = [];
            let chunkCount = 0;
            
            // Create a mock request object for the generateReel function
            const inputPath = job.originalVideoFile?.path;
            if (!inputPath || !fs.existsSync(inputPath)) {
                return reject(new Error(`Input video not found at ${inputPath || '(empty path)'}`));
            }
            console.log('[VTR][Job]', job.jobId, 'generateReelBuffer input:', inputPath);

            const mockReq = {
                file: {
                    path: inputPath,
                    originalname: job.originalVideoFile.originalName,
                    size: job.originalVideoFile.size,
                    mimetype: job.originalVideoFile.mimetype
                },
                body: {
                    srt: job.srt,
                    wordSrt: job.wordSrt,
                    sentences: JSON.stringify(job.importantSentences),
                    paddingSeconds: job.paddingSeconds,
                    maxTotalSeconds: job.maxTotalSeconds,
                    portrait: job.portrait,
                    fontKey: job.fontKey,
                    textColor: job.textColor,
                    backgroundColor: job.backgroundColor,
                    images: JSON.stringify(Array.isArray(requestData?.images) ? requestData.images : [])
                }
            };
            
            // Create a mock response object to capture the video stream
            const mockRes = {
                setHeader: () => {},
                on: () => {},
                once: () => {},
                emit: () => {},
                removeListener: () => {},
                write: (chunk) => {
                    chunks.push(chunk);
                    chunkCount++;
                    
                    // Update progress during generation (10-80%) with debouncing
                    const progress = Math.min(80, 10 + (chunkCount * 0.7)); // Rough progress estimation
                    this.debouncedProgressUpdate(job.jobId, progress, 'processing');
                    return true;
                },
                end: () => {
                    const videoBuffer = Buffer.concat(chunks);
                    console.log('[VTR][Job]', job.jobId, 'generateReelBuffer complete, bytes:', videoBuffer.length);
                    resolve(videoBuffer);
                },
                status: (code) => {
                    // Bubble up errors from controller with more context
                    return {
                        json: (data) => {
                            const message = data?.error || `Video generation failed (status ${code})`;
                            const details = data?.details ? `: ${data.details}` : '';
                            reject(new Error(`${message}${details}`));
                        }
                    };
                },
                json: (data) => {
                    const message = data?.error || 'Video generation failed';
                    const details = data?.details ? `: ${data.details}` : '';
                    reject(new Error(`${message}${details}`));
                }
            };
            
            generateReel(mockReq, mockRes).catch(reject);
        });
    }

    /**
     * Generate up to 3 segment files and return their buffers
     */
    async generateSegmentFiles(job, requestData) {
        const inputPath = job.originalVideoFile?.path;
        if (!inputPath || !fs.existsSync(inputPath)) {
            throw new Error(`Input video not found at ${inputPath || '(empty path)'}`);
        }
        const segments = await generateReelSegments({
            inputPath,
            srt: job.srt,
            wordSrt: job.wordSrt,
            sentences: Array.isArray(requestData?.paragraphs) && requestData.paragraphs.length
                ? requestData.paragraphs // Treat each paragraph (string) as one unit
                : job.importantSentences,
            paragraphIndices: Array.isArray(requestData?.paragraphIndices) ? requestData.paragraphIndices : undefined,
            paddingSeconds: job.paddingSeconds,
            portrait: job.portrait,
            maxCount: Array.isArray(requestData?.paragraphs) ? Math.min(5, Math.max(1, requestData.paragraphs.length)) : 3,
            textColor: job.textColor,
            fontKey: job.fontKey,
            backgroundColor: job.backgroundColor
        });
        if (!segments || segments.length === 0) {
            // Fallback to single buffer using concat path
            const buf = await this.generateReelBuffer(job, requestData);
            return { buffers: [buf] };
        }
        const buffers = segments.map(p => fs.readFileSync(p));
        // Cleanup local files after reading
        try { segments.forEach(p => fs.existsSync(p) && fs.unlinkSync(p)); } catch(_) {}
        return { buffers };
    }

    /**
     * Save video to S3 with organized structure
     */
    async saveVideoToS3(videoBuffer, jobId) {
        try {
            // Create organized S3 key structure for video-to-reels
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const s3Key = `video-to-reels/${jobId}/${timestamp}/reel.mp4`;
            const fileName = `reel_${timestamp}.mp4`;

            // Upload to S3
            const putCmd = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Body: videoBuffer,
                ContentType: 'video/mp4',
                Metadata: {
                    'job-id': jobId,
                    'generated-at': new Date().toISOString(),
                    'type': 'video-to-reels'
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
                fileSize: videoBuffer.length
            };

        } catch (error) {
            console.error('Error saving video-to-reels to S3:', error);
            throw error;
        }
    }

    /**
     * Save multiple videos to S3 under the same jobId
     */
    async saveMultipleVideosToS3(videoBuffers, jobId) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const results = [];
        for (let i = 0; i < videoBuffers.length; i++) {
            const idx = i + 1;
            const s3Key = `video-to-reels/${jobId}/${timestamp}/reel_${idx}.mp4`;
            const fileName = `reel_${idx}_${timestamp}.mp4`;
            const putCmd = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Body: videoBuffers[i],
                ContentType: 'video/mp4',
                Metadata: {
                    'job-id': jobId,
                    'generated-at': new Date().toISOString(),
                    'type': 'video-to-reels',
                    'index': String(idx)
                }
            });
            await s3.send(putCmd);
            const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
            const presignedUrl = await getSignedUrl(s3, getCmd, { expiresIn: 604800 });
            results.push({ key: s3Key, url: presignedUrl, fileName, fileSize: videoBuffers[i].length, index: idx });
        }
        return results;
    }

    /**
     * Get job status
     */
    async getJobStatus(jobId) {
        try {
            return await VideoToReelsJob.getJobById(jobId);
        } catch (error) {
            console.error(`Error getting job status for ${jobId}:`, error);
            throw error;
        }
    }

    // Removed unused methods: getJobsByUserId, cleanupOldJobs

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
                console.warn(`[VTR][Job] ${job.jobId} cleanup skipped, unexpected dir:`, jobDir);
                return;
            }
            if (fs.existsSync(jobDir)) {
                fs.rmSync(jobDir, { recursive: true, force: true });
                console.log(`[VTR][Job] ${job.jobId} cleaned job dir:`, jobDir);
            }
        } catch (err) {
            console.warn(`[VTR][Job] ${job?.jobId} cleanup failed:`, err?.message || err);
        }
    }
}

module.exports = new VideoToReelsJobService();
