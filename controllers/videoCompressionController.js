const VideoCompressionJob = require('../models/VideoCompressionJob');
const {
  getQualityPreset,
  generateOutputFilename,
  getVideoMetadata,
  calculateOptimalSettings,
  compressVideo,
  validateVideoFile,
  isSupportedFormat
} = require('../utils/videoCompressionUtils');
const cleanupService = require('../services/cleanupService');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

// Helper function to get user ID (since authentication is removed)
const getUserId = (req) => {
  // Try to get user ID from various sources
  if (req.user && req.user.id) {
    return req.user.id;
  }
  if (req.client && req.client.id) {
    return req.client.id;
  }
  if (req.session && req.session.userId) {
    return req.session.userId;
  }
  // Use a consistent default user ID
  return 'default-user';
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = './temp/videos';
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}_${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit
  },
  fileFilter: (req, file, cb) => {
    if (isSupportedFormat(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Supported formats: MP4, MOV, AVI, MKV, WEBM, FLV, WMV, M4V'), false);
    }
  }
});

/**
 * Upload video file for compression
 */
const uploadVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No video file uploaded'
      });
    }

    const userId = getUserId(req);
    const filePath = req.file.path;
    const originalFileName = req.file.originalname;
    const fileSize = req.file.size;

    // Validate video file
    const validation = await validateVideoFile(filePath);
    if (!validation.valid) {
      // Clean up uploaded file if validation fails
      await cleanupService.removeFile(filePath);
      return res.status(400).json({
        success: false,
        message: `Invalid video file: ${validation.error}`
      });
    }

    // Create compression job
    const job = new VideoCompressionJob({
      userId,
      originalFileName,
      originalFilePath: filePath,
      originalFileSize: fileSize,
      targetQuality: '720p', // Default quality, will be updated when compression starts
      tempFiles: [filePath]
    });

    await job.save();

    res.status(200).json({
      success: true,
      message: 'Video uploaded successfully',
      data: {
        jobId: job._id,
        originalFileName,
        fileSize,
        duration: validation.duration,
        dimensions: `${validation.width}x${validation.height}`,
        codec: validation.codec
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up uploaded file on error
    if (req.file && req.file.path) {
      await cleanupService.removeFile(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Failed to upload video',
      error: error.message
    });
  }
};

/**
 * Start video compression
 */
const startCompression = async (req, res) => {
  try {
    const { jobId, quality, customSettings } = req.body;
    const userId = getUserId(req);

    // Find the job
    const job = await VideoCompressionJob.findOne({
      _id: jobId,
      userId,
      status: 'pending'
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Compression job not found or already processed'
      });
    }

    // Validate quality preset
    let qualityPreset;
    try {
      qualityPreset = getQualityPreset(quality, customSettings);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    // Update job with target quality
    job.targetQuality = quality;
    if (quality === 'custom' && customSettings) {
      job.customSettings = customSettings;
    }
    job.status = 'processing';
    await job.save();

    // Generate output filename and path
    const outputFileName = generateOutputFilename(job.originalFileName, quality);
    const outputPath = path.join('./temp/compressed', outputFileName);

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Get video metadata and calculate optimal settings
    const metadata = await getVideoMetadata(job.originalFilePath);
    const settings = calculateOptimalSettings(metadata, qualityPreset);

    // Store FFmpeg command for reference
    job.ffmpegCommand = `ffmpeg -i "${job.originalFilePath}" -c:v libx264 -c:a aac -s ${settings.width}x${settings.height} -b:v ${settings.bitrate} -b:a ${settings.audioBitrate} -crf ${settings.crf} -preset medium "${outputPath}"`;
    await job.save();

    // Start compression in background
    compressVideo(job.originalFilePath, outputPath, settings, (progress) => {
      // Update progress in database
      VideoCompressionJob.findByIdAndUpdate(jobId, { progress: Math.round(progress) })
        .catch(err => console.error('Failed to update progress:', err));
    })
    .then(async (result) => {
      // Compression completed successfully
      job.status = 'completed';
      job.progress = 100;
      job.compressedFilePath = outputPath;
      job.compressedFileSize = result.outputSize;
      job.processingTime = result.processingTime;
      job.compressionRatio = result.compressionRatio;
      job.completedAt = new Date();
      job.tempFiles.push(outputPath);
      
      await job.save();

      console.log(`Compression completed for job ${jobId}: ${result.compressionRatio}% reduction`);
    })
    .catch(async (error) => {
      // Compression failed
      job.status = 'failed';
      job.errorMessage = error.message;
      job.completedAt = new Date();
      
      await job.save();

      // Clean up output file if it exists
      try {
        await fs.access(outputPath);
        await cleanupService.removeFile(outputPath);
      } catch (err) {
        // File doesn't exist or already removed
      }

      console.error(`Compression failed for job ${jobId}:`, error.message);
    });

    res.status(200).json({
      success: true,
      message: 'Compression started',
      data: {
        jobId: job._id,
        quality,
        estimatedTime: 'Processing...'
      }
    });

  } catch (error) {
    console.error('Start compression error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start compression',
      error: error.message
    });
  }
};

/**
 * Get compression job status
 */
const getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = getUserId(req);

    const job = await VideoCompressionJob.findOne({
      _id: jobId,
      userId
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Compression job not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        jobId: job._id,
        status: job.status,
        progress: job.progress,
        originalFileName: job.originalFileName,
        targetQuality: job.targetQuality,
        originalFileSize: job.originalFileSize,
        compressedFileSize: job.compressedFileSize,
        compressionRatio: job.compressionRatio,
        processingTime: job.processingTime,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt,
        completedAt: job.completedAt
      }
    });

  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job status',
      error: error.message
    });
  }
};

/**
 * Download compressed video
 */
const downloadCompressedVideo = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = getUserId(req);

    const job = await VideoCompressionJob.findOne({
      _id: jobId,
      userId,
      status: 'completed'
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Compressed video not found or job not completed'
      });
    }

    // Check if file exists
    try {
      await fs.access(job.compressedFilePath);
    } catch (error) {
      return res.status(404).json({
        success: false,
        message: 'Compressed file not found on server'
      });
    }

    // Set headers for file download
    const fileName = generateOutputFilename(job.originalFileName, job.targetQuality);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'video/mp4');

    // Stream the file
    const fileStream = require('fs').createReadStream(job.compressedFilePath);
    fileStream.pipe(res);

    // Clean up after download (optional - you might want to keep files for a while)
    fileStream.on('end', async () => {
      // Schedule cleanup after a delay (e.g., 1 hour)
      setTimeout(async () => {
        await cleanupService.cleanupJobFiles(job.tempFiles);
      }, 60 * 60 * 1000); // 1 hour delay
    });

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download compressed video',
      error: error.message
    });
  }
};

/**
 * Cancel compression job
 */
const cancelJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = getUserId(req);

    const job = await VideoCompressionJob.findOne({
      _id: jobId,
      userId,
      status: { $in: ['pending', 'processing'] }
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found or cannot be cancelled'
      });
    }

    // Update job status
    job.status = 'cancelled';
    job.completedAt = new Date();
    await job.save();

    // Clean up temporary files
    await cleanupService.cleanupJobFiles(job.tempFiles);

    res.status(200).json({
      success: true,
      message: 'Job cancelled successfully'
    });

  } catch (error) {
    console.error('Cancel job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel job',
      error: error.message
    });
  }
};

/**
 * Get user's compression jobs
 */
const getUserJobs = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { page = 1, limit = 10, status } = req.query;

    const query = { userId };
    if (status) {
      query.status = status;
    }

    const jobs = await VideoCompressionJob.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-tempFiles -ffmpegCommand');

    const total = await VideoCompressionJob.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        jobs,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    console.error('Get user jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user jobs',
      error: error.message
    });
  }
};

/**
 * Get available quality presets
 */
const getQualityPresets = (req, res) => {
  try {
    const presets = {
      '720p': { name: '720p HD', description: 'High Definition (1280x720)', bitrate: '3000k' },
      '480p': { name: '480p SD', description: 'Standard Definition (854x480)', bitrate: '1500k' },
      '360p': { name: '360p', description: 'Medium Quality (640x360)', bitrate: '800k' },
      '240p': { name: '240p', description: 'Low Quality (426x240)', bitrate: '400k' },
      '144p': { name: '144p', description: 'Very Low Quality (256x144)', bitrate: '200k' },
      'custom': { name: 'Custom', description: 'Custom settings', bitrate: 'Variable' }
    };

    res.status(200).json({
      success: true,
      data: presets
    });

  } catch (error) {
    console.error('Get presets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get quality presets',
      error: error.message
    });
  }
};

/**
 * Clean up compressed video file after download
 */
const cleanupCompressedFile = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = getUserId(req);

    const job = await VideoCompressionJob.findOne({
      _id: jobId,
      userId
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Compression job not found'
      });
    }

    // Clean up the compressed file
    if (job.compressedFilePath) {
      await cleanupService.removeFile(job.compressedFilePath);
      console.log(`Cleaned up compressed file: ${job.compressedFilePath}`);
    }

    // Update job to mark file as cleaned up
    job.compressedFilePath = null;
    job.tempFiles = job.tempFiles.filter(file => file !== job.compressedFilePath);
    await job.save();

    res.status(200).json({
      success: true,
      message: 'File cleaned up successfully'
    });

  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup file',
      error: error.message
    });
  }
};

module.exports = {
  upload,
  uploadVideo,
  startCompression,
  getJobStatus,
  downloadCompressedVideo,
  cancelJob,
  getUserJobs,
  getQualityPresets,
  cleanupCompressedFile
};
