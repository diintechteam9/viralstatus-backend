const videoToReelsJobService = require('../services/videoToReelsJobService');
const fs = require('fs');
const path = require('path');

// Create a new async subtitles job (overlay wordSrt onto video)
async function createAsyncSubtitleJob(req, res) {
  try {
    const uploadedFile = req.file;
    const { wordSrt, fontKey, textColor } = req.body || {};
    const userId = req.user?.id || req.user?._id || null;

    if (!uploadedFile) {
      return res.status(400).json({ success: false, error: 'Video file is required' });
    }
    if (!wordSrt || typeof wordSrt !== 'string' || wordSrt.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'wordSrt is required' });
    }

    // Build jobData (reuse VideoToReelsJob model)
    const jobData = {
      videoFile: uploadedFile,
      srt: wordSrt, // schema requires srt; we store wordSrt here
      wordSrt: wordSrt,
      sentences: [],
      paddingSeconds: 0,
      maxTotalSeconds: 60,
      portrait: false,
      fontKey: (fontKey || 'notosans'),
      textColor: (textColor || 'white'),
      userId,
      type: 'video-subtitle'
    };

    const job = await videoToReelsJobService.createJob(jobData);

    // Move uploaded to stable job dir
    try {
      const ext = path.extname(uploadedFile.originalname || uploadedFile.path || '').toLowerCase() || '.mp4';
      const jobDir = path.join('temp', 'jobs', job.jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      const stableInputPath = path.join(jobDir, `input${ext}`);
      fs.copyFileSync(uploadedFile.path, stableInputPath);
      try { fs.unlinkSync(uploadedFile.path); } catch (_) {}
      job.originalVideoFile = {
        path: stableInputPath,
        originalName: uploadedFile.originalname,
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype
      };
      await job.save();
      jobData.videoFile = {
        path: stableInputPath,
        originalname: uploadedFile.originalname,
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype
      };
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Failed to prepare input file' });
    }

    await videoToReelsJobService.startSubtitleJob(job.jobId, { ...jobData });

    res.json({ success: true, message: 'Subtitle job started', jobId: job.jobId, status: 'processing', progress: 0 });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to start subtitle job' });
  }
}

async function getJobStatus(req, res) {
  try {
    const { jobId } = req.params;
    const job = await videoToReelsJobService.getJobStatus(jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    return res.json({ success: true, job: {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      videoUrl: job.videoUrl || job.s3Url,
      videos: Array.isArray(job.videos) ? job.videos : (job.videoUrl || job.s3Url ? [{ url: job.videoUrl || job.s3Url, index: 1 }] : []),
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    }});
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to get job status' });
  }
}

async function cleanupJob(req, res) {
  try {
    const { jobId } = req.params;
    const job = await videoToReelsJobService.getJobStatus(jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    if (job.status !== 'completed' && job.status !== 'failed') {
      return res.status(400).json({ success: false, error: 'Job must be completed or failed before cleanup' });
    }
    try { videoToReelsJobService.cleanupJobDirectory(job); } catch (_) {}
    return res.json({ success: true, message: 'Job cleanup completed', jobId });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to cleanup job' });
  }
}

module.exports = { createAsyncSubtitleJob, getJobStatus, cleanupJob };

