const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const { promisify } = require('util');

// Quality presets for video compression
const QUALITY_PRESETS = {
  '720p': {
    width: 1280,
    height: 720,
    bitrate: '3000k',
    crf: 20,
    audioBitrate: '128k'
  },
  '480p': {
    width: 854,
    height: 480,
    bitrate: '1500k',
    crf: 22,
    audioBitrate: '96k'
  },
  '360p': {
    width: 640,
    height: 360,
    bitrate: '800k',
    crf: 24,
    audioBitrate: '64k'
  },
  '240p': {
    width: 426,
    height: 240,
    bitrate: '400k',
    crf: 26,
    audioBitrate: '64k'
  },
  '144p': {
    width: 256,
    height: 144,
    bitrate: '200k',
    crf: 28,
    audioBitrate: '32k'
  }
};

/**
 * Get quality preset configuration
 * @param {string} quality - Quality preset name
 * @param {Object} customSettings - Custom settings if quality is 'custom'
 * @returns {Object} Quality configuration
 */
function getQualityPreset(quality, customSettings = null) {
  if (quality === 'custom' && customSettings) {
    return {
      width: customSettings.width || 1280,
      height: customSettings.height || 720,
      bitrate: customSettings.bitrate || '2000k',
      crf: customSettings.crf || 23,
      audioBitrate: '128k'
    };
  }
  
  if (!QUALITY_PRESETS[quality]) {
    throw new Error(`Invalid quality preset: ${quality}`);
  }
  
  return QUALITY_PRESETS[quality];
}

/**
 * Generate output filename with quality suffix
 * @param {string} originalPath - Original file path
 * @param {string} quality - Target quality
 * @returns {string} Output filename
 */
function generateOutputFilename(originalPath, quality) {
  const ext = path.extname(originalPath);
  const basename = path.basename(originalPath, ext);
  return `${basename}_${quality}${ext}`;
}

/**
 * Get video metadata using ffprobe
 * @param {string} filePath - Path to video file
 * @returns {Promise<Object>} Video metadata
 */
async function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to get video metadata: ${err.message}`));
        return;
      }
      resolve(metadata);
    });
  });
}

/**
 * Calculate optimal settings based on original video dimensions
 * @param {Object} metadata - Video metadata
 * @param {Object} preset - Quality preset
 * @returns {Object} Optimized settings
 */
function calculateOptimalSettings(metadata, preset) {
  const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
  if (!videoStream) {
    throw new Error('No video stream found in file');
  }

  const originalWidth = videoStream.width;
  const originalHeight = videoStream.height;
  const aspectRatio = originalWidth / originalHeight;

  // Calculate new dimensions maintaining aspect ratio
  let newWidth = preset.width;
  let newHeight = preset.height;

  // If original video is smaller than target, don't upscale
  if (originalWidth < preset.width && originalHeight < preset.height) {
    newWidth = originalWidth;
    newHeight = originalHeight;
  } else {
    // Maintain aspect ratio
    if (aspectRatio > preset.width / preset.height) {
      newHeight = Math.round(preset.width / aspectRatio);
    } else {
      newWidth = Math.round(preset.height * aspectRatio);
    }
  }

  return {
    width: newWidth,
    height: newHeight,
    bitrate: preset.bitrate,
    crf: preset.crf,
    audioBitrate: preset.audioBitrate
  };
}

/**
 * Compress video using FFmpeg
 * @param {string} inputPath - Input video path
 * @param {string} outputPath - Output video path
 * @param {Object} settings - Compression settings
 * @param {Function} progressCallback - Progress callback function
 * @returns {Promise<Object>} Compression result
 */
async function compressVideo(inputPath, outputPath, settings, progressCallback = null) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let lastProgress = 0;

    const command = ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size(`${settings.width}x${settings.height}`)
      .videoBitrate(settings.bitrate)
      .audioBitrate(settings.audioBitrate)
      .outputOptions([
        '-crf', settings.crf.toString(),
        '-preset', 'medium',
        '-profile:v', 'high',
        '-level', '4.0',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p'
      ])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progressCallback && progress.percent > lastProgress) {
          lastProgress = Math.min(progress.percent, 100);
          progressCallback(lastProgress);
        }
      })
      .on('end', async () => {
        try {
          const endTime = Date.now();
          const processingTime = Math.round((endTime - startTime) / 1000);
          
          // Get file sizes
          const inputStats = await fs.stat(inputPath);
          const outputStats = await fs.stat(outputPath);
          
          resolve({
            success: true,
            processingTime,
            inputSize: inputStats.size,
            outputSize: outputStats.size,
            compressionRatio: ((inputStats.size - outputStats.size) / inputStats.size * 100).toFixed(2)
          });
        } catch (error) {
          reject(new Error(`Failed to get file stats: ${error.message}`));
        }
      })
      .on('error', (err) => {
        reject(new Error(`FFmpeg compression failed: ${err.message}`));
      });

    command.run();
  });
}

/**
 * Validate video file
 * @param {string} filePath - Path to video file
 * @returns {Promise<Object>} Validation result
 */
async function validateVideoFile(filePath) {
  try {
    const metadata = await getVideoMetadata(filePath);
    const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
    
    if (!videoStream) {
      return { valid: false, error: 'No video stream found' };
    }

    // Check if duration is reasonable (not too short or too long)
    const duration = parseFloat(metadata.format.duration);
    if (duration < 1) {
      return { valid: false, error: 'Video too short (less than 1 second)' };
    }
    if (duration > 3600) { // 1 hour
      return { valid: false, error: 'Video too long (more than 1 hour)' };
    }

    return { 
      valid: true, 
      duration,
      width: videoStream.width,
      height: videoStream.height,
      codec: videoStream.codec_name
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Get supported video formats
 * @returns {Array} Array of supported formats
 */
function getSupportedFormats() {
  return ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v'];
}

/**
 * Check if file format is supported
 * @param {string} filename - File name
 * @returns {boolean} Whether format is supported
 */
function isSupportedFormat(filename) {
  const ext = path.extname(filename).toLowerCase();
  return getSupportedFormats().includes(ext);
}

module.exports = {
  QUALITY_PRESETS,
  getQualityPreset,
  generateOutputFilename,
  getVideoMetadata,
  calculateOptimalSettings,
  compressVideo,
  validateVideoFile,
  getSupportedFormats,
  isSupportedFormat
};
