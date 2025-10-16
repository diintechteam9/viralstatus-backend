const VideoToSegmentsJob = require('../models/VideoToSegmentsJob');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3, BUCKET_NAME } = require('../config/s3');
const fs = require('fs');
const path = require('path');
const { trimByParagraphsInternal } = require('../controllers/videotosegmentscontroller');

class VideoToSegmentsJobService {
  constructor() {
    this.activeJobs = new Map();
    this.maxConcurrentJobs = 2;
    this.progressUpdateTimers = new Map();
  }

  debouncedProgressUpdate(jobId, progress, status) {
    if (this.progressUpdateTimers.has(jobId)) {
      clearTimeout(this.progressUpdateTimers.get(jobId));
    }
    const timer = setTimeout(async () => {
      try {
        const job = await VideoToSegmentsJob.getJobById(jobId);
        if (job) await job.updateProgress(progress, status);
      } catch (_) {}
      finally { this.progressUpdateTimers.delete(jobId); }
    }, 800);
    this.progressUpdateTimers.set(jobId, timer);
  }

  async createJob(jobData) {
    const job = await VideoToSegmentsJob.createJob(jobData);
    return job;
  }

  async startJob(jobId, requestData) {
    const job = await VideoToSegmentsJob.getJobById(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status !== 'pending') throw new Error(`Job ${jobId} not pending`);
    if (this.activeJobs.size >= this.maxConcurrentJobs) throw new Error('Maximum concurrent jobs reached. Please try again later.');
    await job.updateProgress(0, 'processing');
    this.activeJobs.set(jobId, job);
    this.processAsync(jobId, requestData);
    return job;
  }

  async processAsync(jobId, requestData) {
    try {
      const job = await VideoToSegmentsJob.getJobById(jobId);
      if (!job) return;
      this.debouncedProgressUpdate(jobId, 10, 'processing');

      // Generate local segment files using existing trimming logic
      const partialUploaded = [];
      const uploadedIndices = new Set();
      const cropPos = (requestData?.cropPosition) || job.cropPosition || 'middle';
      console.log(`[VTS-JOB] Processing with crop position: ${cropPos}`);
      const { segmentPaths } = await trimByParagraphsInternal({
        jobId,
        inputPath: job.originalVideoFile?.path,
        srt: job.srt,
        wordSrt: job.wordSrt,
        paragraphs: requestData?.paragraphs || job.paragraphs,
        fontKey: job.fontKey,
        textColor: job.textColor,
        logoFilePath: job.logoFile?.path,
        logoPosition: job.logoPosition,
        outroFilePath: job.outroFile?.path,
        cropPosition: cropPos,
        onSegment: async (index, pathToSegment) => {
          try {
            // Upload immediately when a segment is ready
            const buf = fs.readFileSync(pathToSegment);
            const uploadedOne = await this.saveMultipleVideosToS3([buf], jobId);
            if (uploadedOne && uploadedOne[0]) {
              partialUploaded.push(uploadedOne[0]);
              // Mark index-1 as uploaded to avoid re-upload later
              uploadedIndices.add(Math.max(0, Number(index) - 1));
              // Persist partial results for progressive UI
              try {
                const j = await VideoToSegmentsJob.getJobById(jobId);
                if (j) await j.setPartialVideos([...partialUploaded], 40 + Math.min(50, partialUploaded.length * 10));
              } catch (_) {}
            }
          } catch (_) {}
        }
      }, (progress) => this.debouncedProgressUpdate(jobId, Math.min(80, Math.max(10, progress)), 'processing'));

      this.debouncedProgressUpdate(jobId, 90, 'processing');

      // Upload each segment to S3 and build presigned URLs
      // Upload any remaining segments that weren’t uploaded via onSegment (if any)
      const remaining = segmentPaths.filter((_, i) => !uploadedIndices.has(i));
      let uploaded = [];
      if (remaining.length) {
        uploaded = await this.saveMultipleVideosToS3(remaining.map(p => fs.readFileSync(p)), jobId);
      }
      const finalList = partialUploaded.concat(uploaded);

      await job.complete(finalList);

      // If a poolId is attached, also persist reels for this pool immediately
      try {
        if (job.poolId && Array.isArray(finalList) && finalList.length) {
          const Reel = require('../models/Reel');
          const Pool = require('../models/pool');
          const created = await Promise.all(finalList.map(async (v, idx) => {
            try {
              const doc = await Reel.create({
                poolId: job.poolId,
                s3Key: v.key || '',
                s3Url: v.url || '',
                source: 'auto',
                title: `Auto Reel ${idx + 1}`
              });
              return doc;
            } catch (_) { return null; }
          }));
          const count = created.filter(Boolean).length;
          if (count > 0) {
            try { await Pool.findByIdAndUpdate(job.poolId, { $inc: { reelCount: count } }); } catch (_) {}
          }
        }
      } catch (persistErr) {
        console.warn('[VTS-JOB] Failed to persist reels from job completion:', persistErr?.message);
      }

      // Cleanup local temp dir
      try { this.cleanupJobDirectory(job); } catch (_) {}
    } catch (error) {
      const job = await VideoToSegmentsJob.getJobById(jobId);
      if (job) await job.setError(error);
    } finally {
      this.activeJobs.delete(jobId);
      if (this.progressUpdateTimers.has(jobId)) {
        clearTimeout(this.progressUpdateTimers.get(jobId));
        this.progressUpdateTimers.delete(jobId);
      }
    }
  }

  async saveMultipleVideosToS3(videoBuffers, jobId) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const results = [];
    for (let i = 0; i < videoBuffers.length; i++) {
      const idx = i + 1;
      const s3Key = `video-to-segments/${jobId}/${timestamp}/segment_${idx}.mp4`;
      const fileName = `segment_${idx}_${timestamp}.mp4`;
      const putCmd = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: videoBuffers[i],
        ContentType: 'video/mp4',
        Metadata: { 'job-id': jobId, 'generated-at': new Date().toISOString(), 'type': 'video-to-segments', 'index': String(idx) }
      });
      await s3.send(putCmd);
      const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
      const presignedUrl = await getSignedUrl(s3, getCmd, { expiresIn: 604800 });
      results.push({ key: s3Key, url: presignedUrl, fileName, fileSize: videoBuffers[i].length, index: idx });
    }
    return results;
  }

  cleanupJobDirectory(job) {
    try {
      const inputPath = job?.originalVideoFile?.path;
      if (!inputPath) return;
      const jobDir = path.dirname(inputPath);
      const baseTemp = path.normalize(path.join('temp', 'vts', job.jobId));
      if (jobDir.includes(path.normalize(path.join('temp', 'vts'))) || jobDir.includes(baseTemp)) {
        if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

module.exports = new VideoToSegmentsJobService();
