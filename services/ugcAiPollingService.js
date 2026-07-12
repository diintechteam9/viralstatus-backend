const axios       = require('axios');
const UGCVideo    = require('../models/UGCVideo');
const UGCPrompter = require('../models/UGCPrompter');
const { s3Client } = require('../utils/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

const PEXELS_API_KEY = () => process.env.PEXELS_API_KEY || '';
const PEXELS_BASE = 'https://api.pexels.com/v1';

// Fetch B-roll videos from Pexels
async function fetchPexelsVideo(query, minDuration = 5) {
  try {
    if (!PEXELS_API_KEY()) {
      console.warn('[Pexels] API key not configured');
      return null;
    }

    const response = await axios.get(`${PEXELS_BASE}/videos/search`, {
      params: {
        query: query || 'background',
        per_page: 1,
        orientation: 'portrait',
      },
      headers: {
        'Authorization': PEXELS_API_KEY(),
      },
      timeout: 10000,
    });

    if (!response.data.videos || response.data.videos.length === 0) {
      console.warn(`[Pexels] No videos found for query: ${query}`);
      return null;
    }

    const video = response.data.videos[0];
    const videoFile = video.video_files?.find(f => f.quality === 'hd' || f.quality === 'sd');

    if (!videoFile) {
      console.warn('[Pexels] No suitable video file found');
      return null;
    }

    return {
      url: videoFile.link,
      title: video.user?.name || 'Pexels',
      duration: video.duration,
    };
  } catch (err) {
    console.error('[Pexels] Error fetching video:', err.message);
    return null;
  }
}

// Download and store video in R2
async function downloadAndStoreVideo(videoUrl, videoId, userId, promptId) {
  try {
    const response = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });

    const key = `ugc-broll/${promptId}/${userId}_${Date.now()}.mp4`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: Buffer.from(response.data),
      ContentType: 'video/mp4',
    }));

    console.log(`[Pexels] ✅ Video stored: ${key}`);
    return key;
  } catch (err) {
    console.error('[Pexels] Error downloading/storing video:', err.message);
    return null;
  }
}

// Process UGC video with Pexels B-roll
async function processUGCWithPexels(videoDoc) {
  try {
    const prompt = await UGCPrompter.findById(videoDoc.promptId).lean();
    if (!prompt) {
      console.warn(`[Pexels] Prompt not found for video ${videoDoc._id}`);
      return;
    }

    // Fetch B-roll based on prompt category/keywords
    const searchQuery = prompt.brandName || prompt.category || 'background';
    const brollData = await fetchPexelsVideo(searchQuery);

    if (!brollData) {
      console.warn(`[Pexels] Could not fetch B-roll for video ${videoDoc._id}`);
      await UGCVideo.findByIdAndUpdate(videoDoc._id, {
        processingStatus: 'completed',
        processingProgress: 100,
      });
      return;
    }

    // Download and store B-roll
    const brollKey = await downloadAndStoreVideo(
      brollData.url,
      videoDoc._id,
      videoDoc.userId,
      videoDoc.promptId
    );

    if (!brollKey) {
      console.warn(`[Pexels] Failed to store B-roll for video ${videoDoc._id}`);
      await UGCVideo.findByIdAndUpdate(videoDoc._id, {
        processingStatus: 'completed',
        processingProgress: 100,
      });
      return;
    }

    // Update video with B-roll
    await UGCVideo.findByIdAndUpdate(videoDoc._id, {
      processedVideoKey: brollKey,
      processingStatus: 'completed',
      processingProgress: 100,
      status: videoDoc.autoApprovalSettings?.recording ? 'approved' : 'submitted',
    });

    await UGCPrompter.findByIdAndUpdate(videoDoc.promptId, {
      status: videoDoc.autoApprovalSettings?.recording ? 'approved' : 'submitted',
    });

    console.log(`[Pexels] ✅ Video ${videoDoc._id} processed with B-roll`);
  } catch (err) {
    console.error('[Pexels] Error processing video:', err.message);
    await UGCVideo.findByIdAndUpdate(videoDoc._id, {
      processingStatus: 'failed',
    });
  }
}

function startUGCPexelsService() {
  if (!PEXELS_API_KEY()) {
    console.log('[Pexels] PEXELS_API_KEY not set — service disabled');
    return;
  }

  console.log('[Pexels] ✅ Service started — processing UGC videos with B-roll');

  // Process pending videos every 30 seconds
  const interval = setInterval(async () => {
    try {
      const pending = await UGCVideo.find({
        processingStatus: 'processing',
        processedVideoKey: { $exists: false },
      })
        .select('_id promptId userId autoApprovalSettings')
        .lean()
        .limit(5); // Process max 5 at a time

      if (!pending.length) return;

      console.log(`[Pexels] Processing ${pending.length} video(s)...`);
      await Promise.allSettled(pending.map(processUGCWithPexels));
    } catch (err) {
      console.error('[Pexels] Service error:', err.message);
    }
  }, 30000); // Every 30 seconds

  // Cleanup on shutdown
  process.on('SIGTERM', () => clearInterval(interval));
  process.on('SIGINT', () => clearInterval(interval));
}

module.exports = { startUGCPexelsService };
