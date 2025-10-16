const fs = require('fs');
const path = require('path');
const videoToSegmentsJobService = require('../services/videoToSegmentsJobService');
const VideoToSegmentsJob = require('../models/VideoToSegmentsJob');

function sanitizeFilename(filename, maxLength = 50) {
  if (!filename || typeof filename !== 'string') return `video_${Date.now()}`;
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);
  const cleaned = nameWithoutExt.replace(/[^\w\s\-_.]/g, '').replace(/\s+/g, '_');
  const truncated = cleaned.substring(0, Math.max(1, maxLength - ext.length)).replace(/_+$/g, '');
  const finalName = truncated || `video_${Date.now()}`;
  return finalName + ext;
}

async function createAsyncSegmentsJob(req, res) {
  try {
    const uploadedFile = req.file || (req.files && Array.isArray(req.files.video) && req.files.video[0]) || null;
    const outroFile = req.files && Array.isArray(req.files.outro) ? req.files.outro[0] : null;
    const logoFile = req.files && Array.isArray(req.files.logo) ? req.files.logo[0] : null;
    const { srt, wordSrt, paragraphs, fontKey, textColor, logoPosition, cropPosition, poolId } = req.body || {};
    const userId = req.user?.id || req.user?._id || null;
    
    console.log(`[VTS-ASYNC] Received crop position: ${cropPosition}`);

    if (!uploadedFile) return res.status(400).json({ success: false, error: 'Video file is required' });
    if (!srt) return res.status(400).json({ success: false, error: 'SRT content is required' });

    let parsedParagraphs;
    try {
      parsedParagraphs = Array.isArray(paragraphs) ? paragraphs : JSON.parse(paragraphs);
    } catch (_) {
      return res.status(400).json({ success: false, error: 'Invalid paragraphs format' });
    }
    if (!Array.isArray(parsedParagraphs) || parsedParagraphs.length === 0) {
      return res.status(400).json({ success: false, error: 'Paragraphs are required' });
    }

    const jobData = {
      videoFile: uploadedFile,
      outroFile: outroFile ? {
        path: outroFile.path,
        originalname: sanitizeFilename(outroFile.originalname, 50),
        size: outroFile.size,
        mimetype: outroFile.mimetype
      } : null,
      logoFile: logoFile ? {
        path: logoFile.path,
        originalname: sanitizeFilename(logoFile.originalname, 50),
        size: logoFile.size,
        mimetype: logoFile.mimetype
      } : null,
      srt,
      wordSrt: wordSrt || null,
      paragraphs: parsedParagraphs.map(p => Array.isArray(p) ? p.join(' ') : String(p)),
      paddingSeconds: Number(0.3),
      portrait: false,
      fontKey: (fontKey || 'notosans'),
      textColor: (textColor || 'white'),
      logoPosition: (logoPosition || 'top-right'),
      cropPosition: (cropPosition || 'middle'),
      userId,
      poolId: poolId || null
    };

    const job = await videoToSegmentsJobService.createJob(jobData);

    // Move uploaded files into a stable job dir
    try {
      const ext = path.extname(uploadedFile.originalname || uploadedFile.path || '').toLowerCase() || '.mp4';
      const jobDir = path.join('temp', 'vts', job.jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      const stableInputPath = path.join(jobDir, `input${ext}`);
      fs.copyFileSync(uploadedFile.path, stableInputPath);
      try { fs.unlinkSync(uploadedFile.path); } catch (_) {}

      job.originalVideoFile = {
        path: stableInputPath,
        originalName: sanitizeFilename(uploadedFile.originalname, 50),
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype
      };

      // Move optional outro into job dir
      if (outroFile) {
        const oext = path.extname(outroFile.originalname || outroFile.path || '').toLowerCase() || '.mp4';
        const stableOutroPath = path.join(jobDir, `outro${oext}`);
        try {
          fs.copyFileSync(outroFile.path, stableOutroPath);
          try { fs.unlinkSync(outroFile.path); } catch (_) {}
          job.outroFile = {
            path: stableOutroPath,
            originalName: sanitizeFilename(outroFile.originalname, 50),
            size: outroFile.size,
            mimetype: outroFile.mimetype
          };
        } catch (_) {}
      }

      // Move optional logo into job dir
      if (logoFile) {
        const lext = path.extname(logoFile.originalname || logoFile.path || '').toLowerCase() || '.png';
        const stableLogoPath = path.join(jobDir, `logo${lext}`);
        try {
          fs.copyFileSync(logoFile.path, stableLogoPath);
          try { fs.unlinkSync(logoFile.path); } catch (_) {}
          job.logoFile = {
            path: stableLogoPath,
            originalName: sanitizeFilename(logoFile.originalname, 50),
            size: logoFile.size,
            mimetype: logoFile.mimetype
          };
        } catch (_) {}
      }
      await job.save();
    } catch (_) {
      return res.status(500).json({ success: false, error: 'Failed to prepare input file' });
    }

    await videoToSegmentsJobService.startJob(job.jobId, { paragraphs: job.paragraphs, cropPosition: job.cropPosition || 'middle' });

    return res.json({ success: true, message: 'Segments generation started', jobId: job.jobId, status: 'processing', progress: 0 });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to start segments generation' });
  }
}

async function getJobStatus(req, res) {
  try {
    const { jobId } = req.params;
    const JobModel = require('../models/VideoToSegmentsJob');
    const job = await JobModel.getJobById(jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    return res.json({ success: true, job: {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      videos: Array.isArray(job.videos) ? job.videos : [],
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
    const JobModel = require('../models/VideoToSegmentsJob');
    const job = await JobModel.getJobById(jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    if (job.status !== 'completed' && job.status !== 'failed') {
      return res.status(400).json({ success: false, error: 'Job must be completed or failed before cleanup' });
    }
    try {
      const inputPath = job?.originalVideoFile?.path;
      if (inputPath) {
        const dir = path.dirname(inputPath);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (_) {}
    return res.json({ success: true, message: 'Job cleanup completed', jobId });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to cleanup job' });
  }
}

module.exports = { createAsyncSegmentsJob, getJobStatus, cleanupJob };

// Additional helper to fetch completed videos by poolId
async function getPoolVideos(req, res) {
  try {
    const { poolId } = req.params;
    if (!poolId) return res.status(400).json({ success: false, error: 'poolId is required' });
    const jobs = await VideoToSegmentsJob.find({ poolId, status: 'completed' }).sort({ createdAt: -1 }).lean();
    const videos = [];
    for (const job of jobs) {
      if (Array.isArray(job.videos)) {
        for (const v of job.videos) {
          if (v && v.url) {
            videos.push({ url: v.url, jobId: job.jobId, createdAt: job.completedAt || job.updatedAt || job.createdAt });
          }
        }
      }
    }
    return res.json({ success: true, videos });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch pool videos' });
  }
}

module.exports.getPoolVideos = getPoolVideos;


