require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');

const PIXVERSE_BASE = 'https://app-api.pixverse.ai/openapi/v2';

async function uploadImageToPixverse(imageBase64) {
  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const formData = new FormData();
    // Per observed API behavior, the field name must be 'image'
    formData.append('image', imageBuffer, { filename: 'image.jpg', contentType: 'image/jpeg' });

    const resp = await axios({
      method: 'post',
      url: `${PIXVERSE_BASE}/image/upload`,
      headers: { 'API-KEY': process.env.PIXVERSE_API_KEY, 'Ai-trace-id': uuidv4(), ...formData.getHeaders() },
      data: formData,
      timeout: 30000,
    });

    if (resp.data?.ErrCode !== 0) {
      return { success: false, error: resp.data?.ErrMsg || 'Upload failed' };
    }

    const imgId = resp.data?.Resp?.img_id;
    if (!imgId) return { success: false, error: 'No img_id in upload response' };
    return { success: true, img_id: imgId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Helper function to verify video URL is accessible
async function verifyVideoUrl(videoUrl) {
  try {
    const response = await axios({
      method: 'head',
      url: videoUrl,
      timeout: 10000,
      validateStatus: (status) => status < 400, // Accept 2xx and 3xx status codes
    });
    return response.status < 400;
  } catch (error) {
    console.log(`Video URL verification failed for ${videoUrl}:`, error.message);
    return false;
  }
}

async function pollVideoResultUntilReady(videoId, { intervalMs = 5000, timeoutMs = 120000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await axios({
        method: 'get',
        url: `${PIXVERSE_BASE}/video/result/${videoId}`,
        headers: { 'API-KEY': process.env.PIXVERSE_API_KEY, 'Ai-trace-id': uuidv4() },
        timeout: 20000,
      });

      console.log(`Polling video ${videoId}, response:`, resp.data);

      if (resp.data?.ErrCode !== 0) {
        console.log(`Video ${videoId} polling error:`, resp.data?.ErrMsg);
        // Non-zero error code; keep polling briefly or abort
        await new Promise(r => setTimeout(r, intervalMs));
        continue;
      }

      const result = resp.data?.Resp || {};
      console.log(`Video ${videoId} result:`, result);
      
      // Check all possible video URL field names
      const videoUrl = result.video_url || result.url || result.videoUrl || result.video_url_mp4 || result.mp4_url;
      const status = result.status;

      if (videoUrl && status !== 0 && status !== 5) {
        console.log(`Video ${videoId} ready with URL:`, videoUrl);
        
        // Verify the video URL is actually accessible
        const isAccessible = await verifyVideoUrl(videoUrl);
        if (isAccessible) {
          console.log(`Video ${videoId} URL verified as accessible`);
          return { success: true, videoUrl };
        } else {
          console.log(`Video ${videoId} URL not yet accessible, continuing to poll...`);
          await new Promise(r => setTimeout(r, intervalMs));
          continue;
        }
      }

      // If status indicates processing, wait and retry
      if (status === 5 || status === 0 || status === 'processing') {
        console.log(`Video ${videoId} still processing (status: ${status}), retrying in ${intervalMs/1000}s...`);
        await new Promise(r => setTimeout(r, intervalMs));
        continue;
      }

      // Any other state: brief wait and retry as well
      console.log(`Video ${videoId} status: ${status}, retrying in ${intervalMs/1000}s...`);
      await new Promise(r => setTimeout(r, intervalMs));
    } catch (err) {
      console.error(`Error polling video ${videoId}:`, err.message);
      // Network or transient error; wait and retry
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
  return { success: false, error: 'Timed out waiting for video' };
}

const generateVideo = async (req, res) => {
  const {
    image_base64,
    prompt,
    duration = 5,
    model = 'v3.5',
    motion_mode = 'normal',
    negative_prompt = '',
    camera_movement,
    quality = '360p',
    seed = 0,
    template_id,
    water_mark = false,
  } = req.body;

  if (!image_base64 || !prompt) {
    return res.status(400).json({ error: 'image_base64 and prompt are required.' });
  }

  try {
    // 1) Upload image -> img_id
    const upload = await uploadImageToPixverse(image_base64);
    if (!upload.success) return res.status(400).json({ error: 'Failed to upload image to Pixverse', details: upload.error });

    const img_id = upload.img_id;

    // 2) Request video generation
    const payload = {
      duration,
      img_id,
      model,
      motion_mode,
      negative_prompt,
      prompt,
      quality,
      seed,
      water_mark,
    };
    if (camera_movement) payload.camera_movement = camera_movement;
    if (template_id) payload.template_id = template_id;

    const genResp = await axios({
      method: 'post',
      url: `${PIXVERSE_BASE}/video/img/generate`,
      headers: { 'API-KEY': process.env.PIXVERSE_API_KEY, 'Ai-trace-id': uuidv4(), 'Content-Type': 'application/json' },
      data: payload,
      timeout: 60000,
    });

    if (genResp.data?.ErrCode !== 0) {
      return res.status(400).json({ error: genResp.data?.ErrMsg || 'Video generation failed', details: genResp.data });
    }

    const videoId = genResp.data?.Resp?.video_id;
    if (!videoId) return res.status(400).json({ error: 'No video_id in generation response', details: genResp.data });

    // 3) Poll for ready video URL
    const result = await pollVideoResultUntilReady(videoId, { intervalMs: 4000, timeoutMs: 180000 });
    if (!result.success) return res.status(504).json({ error: result.error || 'Video not ready', videoId });

    return res.json({ success: true, videoUrl: result.videoUrl, videoId });
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json({ error: `Pixverse error: ${error.response.status} ${error.response.statusText}`, details: error.response.data });
    }
    return res.status(500).json({ error: error.message || 'Failed to generate video' });
  }
};

module.exports = { generateVideo };
