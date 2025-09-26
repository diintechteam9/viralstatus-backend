const videoToReelsJobService = require('../services/videoToReelsJobService');
const fs = require('fs');
const path = require('path');

/**
 * Create a new async video-to-reels generation job
 * POST /api/vtr/generate-reel-async
 */
const createAsyncReelJob = async (req, res) => {
  try {
    const uploadedFile = req.file;
    const { srt, wordSrt, sentences, paddingSeconds, maxTotalSeconds, portrait, images } = req.body;
    const userId = req.user?.id || req.user?._id || null;

    // Validate required fields
    if (!uploadedFile) {  
      return res.status(400).json({ 
        success: false,
        error: 'Video file is required' 
      });
    }

    if (!srt) {
      return res.status(400).json({ 
        success: false,
        error: 'SRT content is required' 
      });
    }

    if (!sentences) {
      return res.status(400).json({ 
        success: false,
        error: 'Important sentences are required' 
      });
    }

    // Parse sentences if it's a string
    let parsedSentences;
    try {
      parsedSentences = Array.isArray(sentences) ? sentences : JSON.parse(sentences);
    } catch (error) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid sentences format' 
      });
    }

    // Create the job data
    const jobData = {
      videoFile: uploadedFile,
      srt,
      wordSrt: wordSrt || null,
      sentences: parsedSentences,
      paddingSeconds: Number(paddingSeconds || 0.3),
      maxTotalSeconds: Number(maxTotalSeconds || 60),
      portrait: String(portrait || 'false') === 'true',
      userId,
      type: 'video-to-reels'
    };

    // Create the job
    const job = await videoToReelsJobService.createJob(jobData);

    // Move uploaded video into a stable, job-specific working directory
    try {
      const ext = path.extname(uploadedFile.originalname || uploadedFile.path || '').toLowerCase() || '.mp4';
      const jobDir = path.join('temp', 'jobs', job.jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      const stableInputPath = path.join(jobDir, `input${ext}`);
      // Move/copy then unlink original temp file
      fs.copyFileSync(uploadedFile.path, stableInputPath);
      try { fs.unlinkSync(uploadedFile.path); } catch (_) {}

      // Persist the new stable path on the job
      job.originalVideoFile = {
        path: stableInputPath,
        originalName: uploadedFile.originalname,
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype
      };
      await job.save();

      // Update request data used by the service
      jobData.videoFile = {
        path: stableInputPath,
        originalname: uploadedFile.originalname,
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype
      };
    } catch (fileErr) {
      console.error('Failed to prepare stable input file for job', job.jobId, fileErr);
      return res.status(500).json({ success: false, error: 'Failed to prepare input file' });
    }

    // Start processing the job
    // Pass images separately via requestData (not stored in Mongo)
    let runtimeImages = [];
    try {
      if (images) {
        const im = Array.isArray(images) ? images : JSON.parse(images);
        if (Array.isArray(im)) runtimeImages = im.filter(Boolean);
      }
    } catch (_) {}

    await videoToReelsJobService.startJob(job.jobId, { ...jobData, images: runtimeImages });

    // Return immediate response with job ID
    res.json({
      success: true,
      message: 'Reel generation started',
      jobId: job.jobId,
      status: 'processing',
      progress: 0,
      estimatedTime: '1-3 minutes'
    });

  } catch (error) {
    console.error('Error creating async reel job:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start reel generation'
    });
  }
};

/**
 * Get job status for video-to-reels generation
 * GET /api/vtr/job-status/:jobId
 */
const getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = await videoToReelsJobService.getJobStatus(jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    res.json({
      success: true,
      job: {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        videoUrl: job.videoUrl,
        videos: Array.isArray(job.videos) ? job.videos : (job.videoUrl ? [{ url: job.videoUrl, index: 1 }] : []),
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      }
    });

  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get job status'
    });
  }
};

module.exports = {
  createAsyncReelJob,
  getJobStatus
};
