const audioExtractionJobService = require('../services/audioExtractionJobService');
const fs = require('fs');
const path = require('path');

// Utility function to sanitize and truncate filenames
const sanitizeFilename = (filename, maxLength = 50) => {
  if (!filename || typeof filename !== 'string') {
    return `video_${Date.now()}`;
  }
  
  // Remove extension first
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);
  
  // Sanitize: remove special characters, keep only alphanumeric, spaces, hyphens, underscores
  const sanitized = nameWithoutExt
    .replace(/[^\w\s\-_]/g, '') // Remove special characters except word chars, spaces, hyphens, underscores
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .substring(0, maxLength - ext.length) // Truncate to fit within maxLength including extension
    .replace(/_+$/, ''); // Remove trailing underscores
  
  // Ensure we have a valid name
  const finalName = sanitized || `video_${Date.now()}`;
  return finalName + ext;
};

/**
 * Create a new async audio extraction job
 * POST /api/audio/extract-async
 */
const createAsyncAudioExtractionJob = async (req, res) => {
  try {
    const uploadedFile = req.file;
    const userId = req.user?.id || req.user?._id || null;

    // Validate required fields
    if (!uploadedFile) {  
      return res.status(400).json({ 
        success: false,
        error: 'Video file is required' 
      });
    }

    // Create the job data
    const jobData = {
      originalVideoFile: {
        path: uploadedFile.path,
        originalName: uploadedFile.originalname,
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype
      },
      userId,
      type: 'audio-extraction'
    };

    // Create the job
    const job = await audioExtractionJobService.createJob(jobData);

    // Move uploaded video into a stable, job-specific working directory
    try {
      const ext = path.extname(uploadedFile.originalname || uploadedFile.path || '').toLowerCase() || '.mp4';
      const jobDir = path.join('temp', 'jobs', job.jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      const stableInputPath = path.join(jobDir, `input${ext}`);
      // Move/copy then unlink original temp file
      fs.copyFileSync(uploadedFile.path, stableInputPath);
      try { fs.unlinkSync(uploadedFile.path); } catch (_) {}

      // Sanitize the original filename for storage
      const sanitizedOriginalName = sanitizeFilename(uploadedFile.originalname, 50);
      
      // Persist the new stable path on the job
      job.originalVideoFile = {
        path: stableInputPath,
        originalName: sanitizedOriginalName,
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype
      };
      await job.save();

      // Update request data used by the service
      jobData.originalVideoFile = {
        path: stableInputPath,
        originalname: sanitizedOriginalName,
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype
      };
    } catch (fileErr) {
      console.error('Failed to prepare stable input file for job', job.jobId, fileErr);
      return res.status(500).json({ success: false, error: 'Failed to prepare input file' });
    }

    // Start processing the job
    await audioExtractionJobService.startJob(job.jobId);

    // Return immediate response with job ID
    res.json({
      success: true,
      message: 'Audio extraction started',
      jobId: job.jobId,
      status: 'processing',
      progress: 0,
      estimatedTime: '30-60 seconds'
    });

  } catch (error) {
    console.error('Error creating async audio extraction job:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to start audio extraction'
    });
  }
};

/**
 * Get job status for audio extraction
 * GET /api/audio/job-status/:jobId
 */
const getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = await audioExtractionJobService.getJobStatus(jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Debug logging
    console.log(`[Audio][Job Status] ${jobId}:`, {
      status: job.status,
      audioUrl: job.audioS3Url,
      fileName: job.audioFileName
    });

    res.json({
      success: true,
      job: {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        audioUrl: job.audioS3Url,
        audioFileName: job.audioFileName,
        audioFileSize: job.audioFileSize,
        audioDuration: job.audioDuration,
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

/**
 * Clean up job files and directory
 * POST /api/audio/cleanup-job/:jobId
 */
const cleanupJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = await audioExtractionJobService.getJobStatus(jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    // Only allow cleanup for completed or failed jobs
    if (job.status !== 'completed' && job.status !== 'failed') {
      return res.status(400).json({
        success: false,
        error: 'Job must be completed or failed before cleanup'
      });
    }

    // Clean up the job directory
    try {
      audioExtractionJobService.cleanupJobDirectory(job);
      console.log(`[Audio][Cleanup] Manually cleaned job directory for ${jobId}`);
    } catch (cleanupErr) {
      console.warn(`[Audio][Cleanup] ${jobId} cleanup warning:`, cleanupErr?.message || cleanupErr);
    }

    res.json({
      success: true,
      message: 'Job cleanup completed',
      jobId: jobId
    });

  } catch (error) {
    console.error('Error cleaning up job:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cleanup job'
    });
  }
};

module.exports = {
  createAsyncAudioExtractionJob,
  getJobStatus,
  cleanupJob
};
