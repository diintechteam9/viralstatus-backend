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

// Download helper
async function downloadFile(url) {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    return Buffer.from(res.data);
  } catch (err) {
    console.error(`[UGC AI Polling] Download failed for ${url}:`, err.message);
    return null;
  }
}

// Upload helper
async function uploadToR2(key, buffer) {
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'video/mp4',
    }));
    console.log(`[UGC AI Polling] File uploaded to R2: ${key}`);
    return true;
  } catch (err) {
    console.error(`[UGC AI Polling] Upload to R2 failed for ${key}:`, err.message);
    return false;
  }
}

// Poll active AI server jobs every 15 seconds
async function pollRealAiJobs() {
  try {
    const activeJobs = await UGCVideo.find({
      processingStatus: 'processing',
      aiJobId: { $ne: '' }
    }).lean();

    if (!activeJobs.length) return;

    console.log(`[UGC AI Polling] Checking ${activeJobs.length} active job(s)...`);
    const baseUrl = (process.env.UGC_AI_BASE_URL || '').replace(/\/$/, '');
    const token = process.env.UGC_AI_APP_TOKEN;

    if (!baseUrl || !token) {
      console.warn('[UGC AI Polling] UGC_AI_BASE_URL or UGC_AI_APP_TOKEN not set');
      return;
    }

    for (const video of activeJobs) {
      try {
        const res = await axios.get(`${baseUrl}/api/ugc/job/${video.aiJobId}`, {
          headers: { 'X-App-Token': token },
          timeout: 10000
        });

        const job = res.data;
        if (job.status === 'completed' || job.status === 'failed') {
          console.log(`[UGC AI Polling] Job ${video.aiJobId} status changed to: ${job.status}`);

          if (job.status === 'completed') {
            const processedUrl = job.result_video_url;
            const viralUrl = job.viral_video_url;

            let processedKey = '';
            let viralKey = '';

            // Download and save processed video
            if (processedUrl) {
              processedKey = `ugc-processed/${video.promptId}/${video.userId}_${Date.now()}.mp4`;
              const buffer = await downloadFile(processedUrl);
              if (buffer) {
                await uploadToR2(processedKey, buffer);
              }
            }

            // Download and save viral video
            if (viralUrl) {
              viralKey = `ugc-viral/${video.promptId}/${video.userId}_${Date.now()}.mp4`;
              const buffer = await downloadFile(viralUrl);
              if (buffer) {
                await uploadToR2(viralKey, buffer);
              }
            }

            await UGCVideo.findByIdAndUpdate(video._id, {
              processedVideoKey: processedKey,
              viralVideoKey: viralKey,
              processingStatus: 'completed',
              processingProgress: 100,
              status: video.autoApprovalSettings?.recording ? 'approved' : 'submitted',
            });

            await UGCPrompter.findByIdAndUpdate(video.promptId, {
              status: video.autoApprovalSettings?.recording ? 'approved' : 'submitted',
            });

            console.log(`[UGC AI Polling] ✅ Video ${video._id} successfully processed`);
          } else {
            // failed
            await UGCVideo.findByIdAndUpdate(video._id, {
              processingStatus: 'failed',
              processingProgress: 100,
            });
            console.log(`[UGC AI Polling] ❌ Video ${video._id} marked as failed`);
          }
        } else {
          // Update progress if it changed
          const progress = job.progress || 0;
          if (progress !== video.processingProgress) {
            await UGCVideo.findByIdAndUpdate(video._id, {
              processingProgress: progress
            });
            console.log(`[UGC AI Polling] Job ${video.aiJobId} progress updated: ${progress}%`);
          }
        }
      } catch (err) {
        console.error(`[UGC AI Polling] Error checking job ${video.aiJobId}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[UGC AI Polling] Service error:', err.message);
  }
}

function startUGCPexelsService() {
  let pexelsInterval = null;

  if (PEXELS_API_KEY()) {
    console.log('[Pexels] ✅ Service started — processing UGC videos with B-roll');

    // Process pending videos without aiJobId every 30 seconds
    pexelsInterval = setInterval(async () => {
      try {
        const pending = await UGCVideo.find({
          processingStatus: 'processing',
          processedVideoKey: { $exists: false },
          aiJobId: { $in: [null, ''] }
        })
          .select('_id promptId userId autoApprovalSettings')
          .lean()
          .limit(5);

        if (!pending.length) return;

        console.log(`[Pexels] Processing ${pending.length} video(s)...`);
        await Promise.allSettled(pending.map(processUGCWithPexels));
      } catch (err) {
        console.error('[Pexels] Service error:', err.message);
      }
    }, 30000);
  } else {
    console.log('[Pexels] PEXELS_API_KEY not set — Pexels service disabled');
  }

  // Start the AI server polling (runs regardless of Pexels API key)
  console.log('[UGC AI Polling] ✅ Polling service started — checking active AI jobs');
  const aiInterval = setInterval(pollRealAiJobs, 15000); // Check every 15 seconds

  // Cleanup on shutdown
  process.on('SIGTERM', () => {
    if (pexelsInterval) clearInterval(pexelsInterval);
    clearInterval(aiInterval);
  });
  process.on('SIGINT', () => {
    if (pexelsInterval) clearInterval(pexelsInterval);
    clearInterval(aiInterval);
  });
}

module.exports = { startUGCPexelsService };
