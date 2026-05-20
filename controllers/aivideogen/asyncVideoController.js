const videoJobService = require('../../services/videoJobService');

/**
 * Create a new async video generation job
 * POST /api/videocard/generate-finalvideo-async 
 */
const createAsyncVideoJob = async (req, res) => {
  try {
    const { images, audio, srt, imageSrt, deepSrt, cardName, category, cardId, storyScript, sentenceSrt, wordSrt, imagePrompts } = req.body;
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

    // BUG FIX #1 (backend side): imageSrt missing hone par srt ko fallback ke roop mein use karo
    // NewsGenerator jaise tools ek hi SRT bhejte hain jo overlay aur image timing dono ke liye kaam karta hai
    const resolvedImageSrt = imageSrt || deepSrt || srt;
    if (!resolvedImageSrt) {
      return res.status(400).json({ 
        success: false,
        error: 'No SRT provided for image timing (imageSrt or srt required)' 
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
      imageSrt: resolvedImageSrt,
      cardName,
      category,
      userId,
      cardId,
      storyScript,
      sentenceSrt,
      wordSrt,
      imagePrompts
    });

    // Start processing the job
    await videoJobService.startJob(job.jobId, {
      images,
      audio,
      srt,
      imageSrt: resolvedImageSrt
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
 * Refresh S3 URLs for card jobs
 * POST /api/videocard/refresh-urls/:cardId
 */
const refreshCardUrls = async (req, res) => {
  try {
    const { cardId } = req.params;
    
    if (!cardId) {
      return res.status(400).json({
        success: false,
        error: 'Card ID is required'
      });
    }

    const VideoJob = require('../../models/VideoJob');
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const { s3, BUCKET_NAME } = require('../../config/r2');

    // Get all jobs for this card
    const jobs = await VideoJob.getCardJobs(cardId, 50, 0);
    const updatedJobs = [];
    let latestVideoUrl = null;

    for (const job of jobs) {
      let updated = false;
      const updateData = {};

      // Refresh video URL if we have a key
      if (job.s3Key && job.status === 'completed') {
        try {
          const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: job.s3Key });
          const freshVideoUrl = await getSignedUrl(s3, getCmd, { expiresIn: 604800 }); // 1 week
          updateData.s3Url = freshVideoUrl;
          updated = true;
          
          // Track the latest video URL for updating the card
          if (!latestVideoUrl || new Date(job.createdAt) > new Date(latestVideoUrl.createdAt)) {
            latestVideoUrl = {
              url: freshVideoUrl,
              key: job.s3Key,
              createdAt: job.createdAt
            };
          }
        } catch (error) {
          console.warn(`Failed to refresh video URL for job ${job.jobId}:`, error.message);
        }
      }

      // Refresh audio URL if we have a key
      if (job.audioS3Key) {
        try {
          const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: job.audioS3Key });
          const freshAudioUrl = await getSignedUrl(s3, getCmd, { expiresIn: 604800 }); // 1 week
          updateData.audioS3Url = freshAudioUrl;
          updated = true;
        } catch (error) {
          console.warn(`Failed to refresh audio URL for job ${job.jobId}:`, error.message);
        }
      }

      // Refresh image URLs if we have image assets
      if (job.imageAssets && Array.isArray(job.imageAssets) && job.imageAssets.length > 0) {
        const updatedImageAssets = [];
        for (const asset of job.imageAssets) {
          if (asset.s3Key) {
            try {
              const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: asset.s3Key });
              const freshImageUrl = await getSignedUrl(s3, getCmd, { expiresIn: 604800 }); // 1 week
              updatedImageAssets.push({
                ...asset,
                s3Url: freshImageUrl
              });
              updated = true;
            } catch (error) {
              console.warn(`Failed to refresh image URL for job ${job.jobId}, asset ${asset.index}:`, error.message);
              updatedImageAssets.push(asset); // Keep original if refresh fails
            }
          } else {
            updatedImageAssets.push(asset);
          }
        }
        updateData.imageAssets = updatedImageAssets;
      }

      // Update the job if we have any changes
      if (updated) {
        await VideoJob.findByIdAndUpdate(job._id, updateData, { new: true });
        updatedJobs.push({
          jobId: job.jobId,
          ...updateData
        });
      }
    }

    // Update the VideoCard with the latest video URL if we have one
    if (latestVideoUrl) {
      try {
        const VideoCard = require('../../models/aivideogen');
        await VideoCard.findByIdAndUpdate(cardId, {
          latestVideoUrl: latestVideoUrl.url,
          latestVideoS3Key: latestVideoUrl.key,
          updatedAt: new Date()
        });
        console.log(`Updated VideoCard ${cardId} with fresh video URL`);
      } catch (error) {
        console.warn(`Failed to update VideoCard ${cardId} with latest video URL:`, error.message);
      }
    }

    res.json({
      success: true,
      message: `Refreshed URLs for ${updatedJobs.length} jobs`,
      updatedJobs
    });

  } catch (error) {
    console.error('Error refreshing card URLs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh URLs',
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
  refreshCardUrls,
  cancelJob,
  getSystemStatus,
  cleanupOldJobs
};
