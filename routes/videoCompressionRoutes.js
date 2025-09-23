const express = require('express');
const router = express.Router();
const {
  upload,
  uploadVideo,
  startCompression,
  getJobStatus,
  downloadCompressedVideo,
  cancelJob,
  getUserJobs,
  getQualityPresets,
  cleanupCompressedFile
} = require('../controllers/videoCompressionController');
// Authentication removed - users are already logged in when accessing this tool

/**
 * @route   POST /api/compression/upload
 * @desc    Upload video file for compression
 * @access  Public (no authentication required)
 */
router.post('/upload', upload.single('video'), uploadVideo);

/**
 * @route   POST /api/compression/start
 * @desc    Start video compression with specified quality
 * @access  Public (no authentication required)
 */
router.post('/start', startCompression);

/**
 * @route   GET /api/compression/status/:jobId
 * @desc    Get compression job status and progress
 * @access  Public (no authentication required)
 */
router.get('/status/:jobId', getJobStatus);

/**
 * @route   GET /api/compression/download/:jobId
 * @desc    Download compressed video file
 * @access  Public (no authentication required)
 */
router.get('/download/:jobId', downloadCompressedVideo);

/**
 * @route   DELETE /api/compression/cancel/:jobId
 * @desc    Cancel ongoing compression job
 * @access  Public (no authentication required)
 */
router.delete('/cancel/:jobId', cancelJob);

/**
 * @route   GET /api/compression/jobs
 * @desc    Get user's compression jobs with pagination
 * @access  Public (no authentication required)
 */
router.get('/jobs', getUserJobs);

/**
 * @route   GET /api/compression/presets
 * @desc    Get available quality presets
 * @access  Public (no authentication required)
 */
router.get('/presets', getQualityPresets);

/**
 * @route   DELETE /api/compression/cleanup/:jobId
 * @desc    Clean up compressed video file after download
 * @access  Public (no authentication required)
 */
router.delete('/cleanup/:jobId', cleanupCompressedFile);

module.exports = router;
