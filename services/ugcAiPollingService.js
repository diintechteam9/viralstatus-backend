const cron        = require('node-cron');
const axios       = require('axios');
const UGCVideo    = require('../models/UGCVideo');
const UGCPrompter = require('../models/UGCPrompter');
const { s3Client } = require('../utils/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

const AI_BASE  = () => (process.env.UGC_AI_BASE_URL || '').replace(/\/$/, '');
const AI_TOKEN = () => process.env.UGC_AI_APP_TOKEN || '';
const aiHeaders = () => ({ 'X-App-Token': AI_TOKEN() });

// Max age before marking stuck jobs as failed (30 minutes)
const MAX_PROCESSING_MS = 30 * 60 * 1000;

async function processOneJob(doc) {
  const base = AI_BASE();
  const toAbsoluteUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return `${base}${url}`;
  };

  try {
    const { data } = await axios.get(`${AI_BASE()}/api/ugc/job/${doc.aiJobId}`, {
      headers: aiHeaders(),
      timeout: 10000,
    });

    if (data.status === 'completed') {
      const updates = { processingStatus: 'completed', processingProgress: 100 };

      if (data.result_video_url) {
        try {
          const videoRes = await axios.get(toAbsoluteUrl(data.result_video_url), { responseType: 'arraybuffer', timeout: 120000 });
          const key = `ugc-processed/${doc.promptId}/${doc.userId}_${Date.now()}.mp4`;
          await s3Client.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET, Key: key,
            Body: Buffer.from(videoRes.data), ContentType: 'video/mp4',
          }));
          updates.processedVideoKey = key;
        } catch (_) {}
      }

      if (data.viral_video_url) {
        try {
          const viralRes = await axios.get(toAbsoluteUrl(data.viral_video_url), { responseType: 'arraybuffer', timeout: 120000 });
          const key = `ugc-viral/${doc.promptId}/${doc.userId}_${Date.now()}.mp4`;
          await s3Client.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET, Key: key,
            Body: Buffer.from(viralRes.data), ContentType: 'video/mp4',
          }));
          updates.viralVideoKey = key;
        } catch (_) {}
      }

      updates.status = doc.autoApprovalSettings?.recording ? 'approved' : 'submitted';
      await UGCVideo.findByIdAndUpdate(doc._id, updates);
      await UGCPrompter.findByIdAndUpdate(doc.promptId, { status: updates.status });
      console.log(`[UGC Polling] ✅ Job ${doc.aiJobId} completed for video ${doc._id}`);

    } else if (data.status === 'failed') {
      await UGCVideo.findByIdAndUpdate(doc._id, { processingStatus: 'failed' });
      console.log(`[UGC Polling] ❌ Job ${doc.aiJobId} failed for video ${doc._id}`);

    } else {
      // Still processing — update progress
      await UGCVideo.findByIdAndUpdate(doc._id, { processingProgress: data.progress || 0 });

      // Mark as failed if stuck too long
      const age = Date.now() - new Date(doc.updatedAt).getTime();
      if (age > MAX_PROCESSING_MS) {
        await UGCVideo.findByIdAndUpdate(doc._id, { processingStatus: 'failed' });
        console.warn(`[UGC Polling] ⏰ Job ${doc.aiJobId} timed out after 30min`);
      }
    }
  } catch (err) {
    console.error(`[UGC Polling] Error for job ${doc.aiJobId}:`, err.message);
  }
}

function startUGCAiPolling() {
  if (!AI_BASE()) {
    console.log('[UGC Polling] UGC_AI_BASE_URL not set — polling disabled');
    return;
  }

  // Run every 15 seconds
  cron.schedule('*/15 * * * * *', async () => {
    try {
      const pending = await UGCVideo.find({ processingStatus: 'processing', aiJobId: { $ne: '' } })
        .select('_id aiJobId promptId userId autoApprovalSettings updatedAt')
        .lean();

      if (!pending.length) return;

      console.log(`[UGC Polling] Checking ${pending.length} active job(s)...`);
      await Promise.allSettled(pending.map(processOneJob));
    } catch (err) {
      console.error('[UGC Polling] Cron error:', err.message);
    }
  });

  console.log('[UGC Polling] ✅ Started — polling every 15s');
}

module.exports = { startUGCAiPolling };
