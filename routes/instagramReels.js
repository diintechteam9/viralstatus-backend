//converter
const express = require('express');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const { spawnSync, spawn } = require('child_process');
const ffprobePath = require('ffprobe-static').path;
const ffmpegPath = require('ffmpeg-static');
const InstagramAccount = require('../models/InstagramAccount');
const router = express.Router();

// Configure multer for video upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/reels';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max file size
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/quicktime'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only MP4 and MOV files are allowed.'));
    }
  }
});

// --- Video Validation and Conversion Helpers ---
async function validateVideo(filePath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ];
    let ffprobe;
    try {
      ffprobe = spawnSync(ffprobePath, args, { encoding: 'utf-8', timeout: 20000 }); // 20s timeout
    } catch (err) {
      console.error('[ffprobe] Spawn error:', err);
      return reject(err);
    }
    if (ffprobe.error) {
      console.error('[ffprobe] Error:', ffprobe.error);
      return reject(ffprobe.error);
    }
    if (ffprobe.status !== 0) {
      console.error('[ffprobe] Non-zero exit code:', ffprobe.stderr);
      return reject(new Error('ffprobe failed'));
    }
    let info;
    try {
      info = JSON.parse(ffprobe.stdout);
    } catch (e) {
      console.error('[ffprobe] JSON parse error:', e);
      return reject(new Error('Could not parse video metadata'));
    }
    // Format
    const format = info.format.format_name;
    if (!format.includes('mov') && !format.includes('mp4')) return resolve(false);

    // File size
    if (parseInt(info.format.size) > 100 * 1024 * 1024) return resolve(false);

    // Video stream
    const videoStream = info.streams.find(s => s.codec_type === 'video');
    if (!videoStream) return resolve(false);
    if (videoStream.codec_name !== 'h264') return resolve(false);
    if (videoStream.width > 1080 || videoStream.height > 1920) return resolve(false);

    // Frame rate
    if (videoStream.avg_frame_rate) {
      const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
      const fps = num / den;
      if (fps < 23 || fps > 60) return resolve(false);
    }

    // Aspect ratio (9:16)
    const aspect = videoStream.width / videoStream.height;
    if (Math.abs(aspect - (9/16)) > 0.02) return resolve(false);

    // Audio stream
    const audioStream = info.streams.find(s => s.codec_type === 'audio');
    if (!audioStream || audioStream.codec_name !== 'aac') return resolve(false);
    return resolve(true);
  });
}

function convertVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-ss', '00:00:00',
      '-t', '00:03:00',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2',
      '-r', '30',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];
    const ffmpeg = spawn(ffmpegPath, args);
    let errorOutput = '';
    ffmpeg.stderr.on('data', data => {
      errorOutput += data.toString();
    });
    ffmpeg.on('close', code => {
      if (code === 0) resolve();
      else {
        console.error('[ffmpeg] Error output:', errorOutput);
        reject(new Error('ffmpeg failed to convert video'));
      }
    });
    ffmpeg.on('error', err => {
      console.error('[ffmpeg] Spawn error:', err);
      reject(err);
    });
  });
}

// Upload Reel endpoint
router.post('/upload', upload.single('video'), async (req, res) => {
  let tempConvertedPath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No video file provided' });
    }
    const { userId, caption } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    const instagramAccount = await InstagramAccount.findOne({ instagramId: userId });
    if (!instagramAccount) {
      return res.status(404).json({ message: 'Instagram account not found' });
    }
    // Validate video
    let isValid = false;
    try {
      isValid = await validateVideo(req.file.path);
    } catch (e) {
      console.error('Validation error:', e);
      isValid = false;
    }
    let videoPathToUse = req.file.path;
    if (!isValid) {
      // Convert video
      tempConvertedPath = path.join(path.dirname(req.file.path), `${Date.now()}-converted.mp4`);
      await convertVideo(req.file.path, tempConvertedPath);
      videoPathToUse = tempConvertedPath;
    }

    // Serve the video file through a dedicated endpoint to ensure it's ready
    const videoFileName = path.basename(videoPathToUse);
    const videoUrl = `${process.env.BASE_URL}/api/instagram/reels/stream/${videoFileName}`;

    console.log(`[Instagram Upload] Attempting to use video URL: ${videoUrl}`);
    // 1. Create Container
    const containerResponse = await axios.post(
      `https://graph.facebook.com/v15.0/${instagramAccount.instagramId}/media`,
      {
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption || '',
        share_to_feed: 'true',
        access_token: instagramAccount.accessToken
      }
    );
    console.log('[Instagram Upload] Media container creation response:', containerResponse.data);
    if (!containerResponse.data?.id) {
      throw new Error('Failed to create media container');
    }
    const containerId = containerResponse.data.id;
    // 2. Check media status
    let mediaStatus;
    let attempts = 0;
    const maxAttempts = 30; // Increased to 30 attempts (30 * 5s = 150s or 2.5 mins)
    while (attempts < maxAttempts) {
      const statusResponse = await axios.get(
        `https://graph.facebook.com/v15.0/${containerId}`,
        {
          params: {
            fields: 'status_code,status',
            access_token: instagramAccount.accessToken
          }
        }
      );
      mediaStatus = statusResponse.data;
      console.log(`[Instagram Upload] Media status check (Attempt ${attempts + 1}):`, mediaStatus);
      if (mediaStatus.status_code === 'FINISHED') {
        break;
      } else if (mediaStatus.status_code === 'ERROR') {
        console.error('[Instagram Upload] Media container processing failed with status: ERROR', mediaStatus);
        throw new Error('Media processing failed on Instagrams side.');
      }
      await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5s
      attempts++;
    }

    // 3. Publish the container if processing is finished
    if (mediaStatus?.status_code !== 'FINISHED') {
      console.error(`[UploadReel] Media processing timed out after ${maxAttempts * 5} seconds.`);
      throw new Error('Media processing timed out');
    }

    const publishResponse = await axios.post(
      `https://graph.facebook.com/v15.0/${instagramAccount.instagramId}/media_publish`,
      {
        creation_id: containerId,
        access_token: instagramAccount.accessToken
      }
    );

    if (!publishResponse.data?.id) {
      throw new Error('Failed to publish reel');
    }

    // Clean up the original and converted files after a delay
    setTimeout(() => {
      if (req.file.path) fs.unlink(req.file.path, (err) => {
        if (err) console.error(`Failed to delete original file: ${req.file.path}`, err);
      });
      if (tempConvertedPath) fs.unlink(tempConvertedPath, (err) => {
        if (err) console.error(`Failed to delete converted file: ${tempConvertedPath}`, err);
      });
    }, 60 * 5 * 1000); // 5 minutes delay

    res.json({
      message: 'Reel uploaded successfully',
      url: `https://www.instagram.com/reel/${publishResponse.data.id}`,
      id: publishResponse.data.id
    });

  } catch (error) {
    console.error('[UploadReel] Error:', error.message);
    // Clean up files on error
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    if (tempConvertedPath && fs.existsSync(tempConvertedPath)) {
      fs.unlinkSync(tempConvertedPath);
    }
    res.status(500).json({ message: 'Failed to upload reel', error: error.message });
  }
});

// --- Dedicated Endpoint to Stream Video ---
router.get('/stream/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, '..', 'uploads', 'reels', filename);

  console.log(`[Video Stream] Request for file: ${filename}`);
  console.log(`[Video Stream] Full path: ${filePath}`);

  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size
    });
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  } else {
    console.error(`[Video Stream] File not found: ${filePath}`);
    res.status(404).json({ message: 'File not found' });
  }
});

module.exports = router;