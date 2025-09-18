const videoJobService = require('../../services/videoJobService');

/**
 * Create a new async video generation job
 * POST /api/videocard/generate-finalvideo-async
 */
const createAsyncVideoJob = async (req, res) => {
  try {
    const { images, audio, srt, imageSrt, deepSrt, cardName, category, cardId, storyScript, sentenceSrt, wordSrt } = req.body;
    const userId = req.user?.id || req.user?._id || null; // Handle different user ID formats, allow null for unauthenticated users

    // Validate required fields
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No images provided' 
      });
    }
    
    if (!audio) {
      return res.status(400).json({ 
        success: false,
        error: 'No audio provided' 
      });
    }

    if (!srt) {
      return res.status(400).json({ 
        success: false,
        error: 'No overlay SRT provided' 
      });
    }

    if (!imageSrt && !deepSrt) {
      return res.status(400).json({ 
        success: false,
        error: 'No Deepgram SRT provided for image timing (imageSrt)' 
      });
    }

    if (!cardName) {
      return res.status(400).json({ 
        success: false,
        error: 'Card name is required' 
      });
    }

    if (!category) {
      return res.status(400).json({ 
        success: false,
        error: 'Category is required' 
      });
    }

    // Create the job
    const job = await videoJobService.createJob({
      images,
      audio,
      srt,
      imageSrt: imageSrt || deepSrt,
      cardName,
      category,
      userId,
      cardId,
      storyScript,
      sentenceSrt,
      wordSrt
    });

    // Start processing the job
    await videoJobService.startJob(job.jobId, {
      images,
      audio,
      srt,
      imageSrt: imageSrt || deepSrt
    });

    // Return immediate response with job ID
    res.json({
      success: true,
      message: 'Video generation started',
      jobId: job.jobId,
      status: 'processing',
      progress: 0,
      cardName: job.cardName,
      category: job.category,
      estimatedTime: '2-5 minutes' // Rough estimate
    });

  } catch (error) {
    console.error('Error creating async video job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start video generation',
      details: error.message
    });
  }
};

/**
 * Get job status
 * GET /api/videocard/job-status/:jobId
 */
const getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'Job ID is required'
      });
    }

    const jobStatus = await videoJobService.getJobStatus(jobId);

    res.json({
      success: true,
      job: jobStatus
    });

  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get job status',
      details: error.message
    });
  }
};

/**
 * Get user's video jobs
 * GET /api/videocard/user-jobs
 */
const getUserJobs = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { limit = 10, skip = 0 } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'User authentication required to view jobs'
      });
    }

    const jobs = await videoJobService.getUserJobs(userId, parseInt(limit), parseInt(skip));

    res.json({
      success: true,
      jobs,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        total: jobs.length
      }
    });

  } catch (error) {
    console.error('Error getting user jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user jobs',
      details: error.message
    });
  }
};

/**
 * Get card's video jobs (history)
 * GET /api/videocard/card-jobs/:cardId
 */
const getCardJobs = async (req, res) => {
  try {
    const { cardId } = req.params;
    const { limit = 20, skip = 0 } = req.query;

    const VideoJob = require('../../models/VideoJob');
    const jobs = await VideoJob.getCardJobs(cardId, parseInt(limit), parseInt(skip));

    res.json({
      success: true,
      jobs
    });

  } catch (error) {
    console.error('Error getting card jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get card jobs',
      details: error.message
    });
  }
};

/**
 * Cancel a job
 * DELETE /api/videocard/job/:jobId
 */
const cancelJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'Job ID is required'
      });
    }

    const cancelled = await videoJobService.cancelJob(jobId);

    if (cancelled) {
      res.json({
        success: true,
        message: 'Job cancelled successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Job cannot be cancelled (already processing or completed)'
      });
    }

  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel job',
      details: error.message
    });
  }
};

/**
 * Get system status (for monitoring)
 * GET /api/videocard/system-status
 */
const getSystemStatus = async (req, res) => {
  try {
    const status = videoJobService.getSystemStatus();

    res.json({
      success: true,
      system: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting system status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get system status',
      details: error.message
    });
  }
};

/**
 * Cleanup old jobs (admin endpoint)
 * POST /api/videocard/cleanup-jobs
 */
const cleanupOldJobs = async (req, res) => {
  try {
    const deletedCount = await videoJobService.cleanupOldJobs();

    res.json({
      success: true,
      message: `Cleaned up ${deletedCount} old jobs`,
      deletedCount
    });

  } catch (error) {
    console.error('Error cleaning up old jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup old jobs',
      details: error.message
    });
  }
};

module.exports = {
  createAsyncVideoJob,
  getJobStatus,
  getUserJobs,
  getCardJobs,
  cancelJob,
  getSystemStatus,
  cleanupOldJobs
};
