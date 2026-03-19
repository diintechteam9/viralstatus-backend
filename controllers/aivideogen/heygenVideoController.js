// Required dependencies and environment setup
require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const { s3Client, getobject } = require('../../utils/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;

async function uploadImageToHeyGen(imageBase64) {
  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const key = `heygen/images/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: imageBuffer,
      ContentType: 'image/jpeg',
    }));
    const presignedUrl = await getobject(key);
    console.log("S3 Image URL for HeyGen:", presignedUrl); // <-- Added for debugging
    if (!presignedUrl) {
      return { success: false, error: 'Failed to generate image URL' };
    }
    return { success: true, imageUrl: presignedUrl, s3Key: key };
  } catch (error) {
    console.error('HeyGen image upload error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Failed to upload image to HeyGen',
    };
  }
}

async function pollPhotoAvatarGenerationStatus(generationId, maxTries = 15, delay = 4000) {
  let attempt = 0;
  while (attempt < maxTries) {
    attempt++;
    const resp = await axios.get(
      `https://api.heygen.com/v2/photo_avatar/generation/${generationId}`,
      {
        headers: {
          'X-Api-Key': process.env.HEYGEN_API_KEY,
          Accept: 'application/json',
        },
        timeout: 30000,
        validateStatus: () => true,
      }
    );
    const status = resp.data?.data?.status || resp.data?.status;
    const errMsg = resp.data?.data?.error?.message || resp.data?.error || resp.data?.message;
    console.log(`HeyGen avatar status [${generationId}] attempt ${attempt}:`, status || 'unknown', errMsg ? `| err: ${errMsg}` : '');
    if (status === 'completed' || status === 'success' || status === 'succeeded') {
      const data = resp.data?.data || {};
      return {
        ready: true,
        photoAvatarId: data.photo_avatar_id,
        talkingPhotoId: data.talking_photo_id || data.photo_avatar_id, // Some APIs alias this
        avatarId: data.avatar_id,
        raw: data,
      };
    }
    if (status === 'failed') {
      return { ready: false, error: errMsg || 'Avatar generation failed' };
    }
    await new Promise(res => setTimeout(res, delay));
  }
  return { ready: false, error: 'Avatar generation timed out' };
}

async function generateVideoWithHeyGen(imageUrl, script, customMotion, voiceId) {
  try {
    // Step 1: Start photo avatar generation
    const createRes = await axios.post(
      'https://api.heygen.com/v2/photo_avatar/photo/generate',
      {
        name: "Test Avatar",
        gender: "Man",
        ethnicity: "White",
        style: "Realistic",
        orientation: "square",
        pose: "half_body",
        appearance: "string",
        age: "Early Middle Age",
        image_url: imageUrl,
      },
      {
        headers: {
          'X-Api-Key': process.env.HEYGEN_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 30000,
        validateStatus: () => true,
      }
    );

    const generationId = createRes.data?.data?.generation_id;
    if (!generationId) {
      console.error("HeyGen API ERROR (photo_avatar.generate):", JSON.stringify(createRes.data, null, 2));
      return { success: false, error: 'Failed to get generation_id from HeyGen', apiResp: createRes.data };
    }

    // Step 2: Poll for generation completion (extend maxTries or delay as needed)
    const pollResult = await pollPhotoAvatarGenerationStatus(generationId, 60, 5000);
    if (!pollResult.ready) {
      return { success: false, error: pollResult.error || 'Avatar not ready in time', generationId };
    }
    const talkingPhotoId = pollResult.talkingPhotoId || pollResult.photoAvatarId;
    const avatarId = pollResult.avatarId;
    console.log('HeyGen avatar ready. IDs:', {
      avatarId,
      talkingPhotoId,
      photoAvatarId: pollResult.photoAvatarId,
      raw: pollResult.raw,
    });

    // Step 3: Generate video using completed photo avatar
    const character = avatarId
      ? { type: 'avatar', avatar_id: avatarId }
      : { type: 'avatar', talking_photo_id: talkingPhotoId };

    const payload = {
      video_inputs: [
        {
          character,
          voice: {
            type: 'text',
            input_text: script,
            voice_id: voiceId || 'default',
          },
        },
      ],
    };
    if (customMotion && customMotion.trim()) {
      payload.video_inputs[0].gesture = customMotion.trim();
    }
    console.log('HeyGen video.generate character payload:', JSON.stringify(character));

    const response = await axios.post(
      'https://api.heygen.com/v2/video/generate',
      payload,
      {
        headers: {
          'X-Api-Key': process.env.HEYGEN_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 60000,
        validateStatus: () => true,
      }
    );
    console.log('HeyGen video.generate response status:', response.status);
    if (response.status < 200 || response.status >= 300) {
      console.error('HeyGen video.generate error:', JSON.stringify(response.data, null, 2));
      return {
        success: false,
        error: response.data?.error?.message || `Video generate failed (${response.status})`,
        apiResp: response.data,
      };
    }
    const videoId = response.data?.data?.video_id || response.data?.video_id || response.data?.id;
    const taskId = response.data?.data?.task_id || response.data?.task_id || response.data?.data?.task?.id;
    if (videoId) {
      return { success: true, videoId };
    }
    if (taskId) {
      return { success: true, taskId };
    }
    console.error('HeyGen video.generate unexpected response (no videoId/taskId):', JSON.stringify(response.data, null, 2));
    return { success: false, error: 'Failed to get video or task ID from response', apiResp: response.data };

  } catch (error) {
    console.error('HeyGen video generation error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Failed to generate video',
    };
  }
}


async function checkVideoStatus(videoId) {
  try {
    const response = await axios.get(
      `https://api.heygen.com/v1/video_status.get?video_id=${videoId}`,
      {
        headers: {
          'x-api-key': HEYGEN_API_KEY,
          Accept: 'application/json',
        },
        timeout: 30000,
        validateStatus: () => true,
      }
    );
    if (response.status < 200 || response.status >= 300) {
      return { success: false, error: `Status check failed (${response.status})` };
    }
    const data = response.data?.data || response.data || {};
    return {
      success: true,
      status: data.status || 'processing',
      videoUrl: data.video_url || null,
      error: data.error || null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Failed to check video status',
    };
  }
}

// New: check video task status (v2) and return video_id once ready
async function checkVideoTaskStatus(taskId) {
  try {
    const response = await axios.get(
      `https://api.heygen.com/v2/video/status/${taskId}`,
      {
        headers: {
          'X-Api-Key': HEYGEN_API_KEY,
          Accept: 'application/json',
        },
        timeout: 30000,
        validateStatus: () => true,
      }
    );
    if (response.status < 200 || response.status >= 300) {
      return { success: false, error: `Task status check failed (${response.status})` };
    }
    const data = response.data?.data || response.data || {};
    return {
      success: true,
      status: data.status || 'processing',
      videoId: data.video_id || data?.result?.video_id || null,
      error: data.error || null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Failed to check task status',
    };
  }
}

const generateVideo = async (req, res) => {
  try {
    const { image_base64, script, customMotion, voice } = req.body;
    if (!image_base64) return res.status(400).json({ success: false, error: 'Image is required' });
    if (!script?.trim()) return res.status(400).json({ success: false, error: 'Script is required' });
    if (!HEYGEN_API_KEY) return res.status(500).json({ success: false, error: 'HeyGen API key missing' });

    const uploadResult = await uploadImageToHeyGen(image_base64);
    if (!uploadResult.success)
      return res.status(400).json({ success: false, error: uploadResult.error });

    const generateResult = await generateVideoWithHeyGen(
      uploadResult.imageUrl,
      script.trim(),
      customMotion || '',
      voice || 'default'
    );
    if (!generateResult.success) {
      // If avatar is still processing, return 202 with generationId so frontend can poll avatar status endpoint
      if (generateResult.error?.includes('timed out') || generateResult.error?.includes('not ready')) {
        return res.status(202).json({
          success: true,
          pending: true,
          message: generateResult.error,
          generationId: generateResult.generationId,
        });
      }
      return res.status(400).json({ success: false, error: generateResult.error, apiError: generateResult.apiResp });
    }
    // If HeyGen returned a task id (no immediate videoId), let frontend poll task status
    if (!generateResult.videoId && generateResult.taskId) {
      return res.status(202).json({
        success: true,
        pending: true,
        taskId: generateResult.taskId,
        message: 'Video task created. Poll task status to retrieve videoId.',
      });
    }

    return res.json({
      success: true,
      videoId: generateResult.videoId,
      message: 'Video generation started. Use videoId to check status.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to generate video' });
  }
};

// New: start avatar generation and return generationId immediately
const startAvatarGeneration = async (req, res) => {
  try {
    const { image_base64 } = req.body;
    if (!image_base64) return res.status(400).json({ success: false, error: 'Image is required' });
    if (!HEYGEN_API_KEY) return res.status(500).json({ success: false, error: 'HeyGen API key missing' });

    const uploadResult = await uploadImageToHeyGen(image_base64);
    if (!uploadResult.success)
      return res.status(400).json({ success: false, error: uploadResult.error });

    const createRes = await axios.post(
      'https://api.heygen.com/v2/photo_avatar/photo/generate',
      {
        name: 'Avatar',
        orientation: 'square',
        pose: 'half_body',
        style: 'Realistic',
        image_url: uploadResult.imageUrl,
      },
      {
        headers: {
          'X-Api-Key': process.env.HEYGEN_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 30000,
        validateStatus: () => true,
      }
    );

    if (createRes.status < 200 || createRes.status >= 300) {
      return res.status(400).json({ success: false, error: createRes.data?.error?.message || 'Failed to start avatar generation', apiError: createRes.data });
    }

    const generationId = createRes.data?.data?.generation_id;
    if (!generationId) {
      return res.status(400).json({ success: false, error: 'No generation_id returned', apiError: createRes.data });
    }

    return res.status(202).json({ success: true, generationId, message: 'Avatar generation started' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.response?.data?.message || error.message || 'Failed to start avatar generation' });
  }
};

// New: check avatar generation status (single check)
const getAvatarGenerationStatus = async (req, res) => {
  try {
    const { generationId } = req.params;
    if (!generationId) return res.status(400).json({ success: false, error: 'generationId is required' });
    if (!HEYGEN_API_KEY) return res.status(500).json({ success: false, error: 'HeyGen API key missing' });

    const resp = await axios.get(`https://api.heygen.com/v2/photo_avatar/generation/${generationId}`,
      {
        headers: { 'X-Api-Key': process.env.HEYGEN_API_KEY, Accept: 'application/json' },
        timeout: 30000,
        validateStatus: () => true,
      }
    );

    const status = resp.data?.data?.status || resp.data?.status;
    const data = resp.data?.data || {};
    const errorMsg = data?.error?.message || resp.data?.error || null;

    return res.json({
      success: true,
      status,
      photo_avatar_id: data.photo_avatar_id || null,
      talking_photo_id: data.talking_photo_id || data.photo_avatar_id || null,
      avatar_id: data.avatar_id || null,
      error: errorMsg,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.response?.data?.message || error.message || 'Failed to check avatar status' });
  }
};

// New: generate video from an existing talking_photo or avatar id
const generateVideoFromAvatar = async (req, res) => {
  try {
    const { talking_photo_id, avatar_id, photo_avatar_id, script, customMotion, voice } = req.body;
    if (!talking_photo_id && !avatar_id && !photo_avatar_id) return res.status(400).json({ success: false, error: 'talking_photo_id or avatar_id is required' });
    if (!script?.trim()) return res.status(400).json({ success: false, error: 'Script is required' });
    if (!HEYGEN_API_KEY) return res.status(500).json({ success: false, error: 'HeyGen API key missing' });

    const character = avatar_id
      ? { type: 'avatar', avatar_id }
      : { type: 'avatar', talking_photo_id: talking_photo_id || photo_avatar_id };

    const payload = {
      video_inputs: [
        {
          character,
          voice: { type: 'text', input_text: script.trim(), voice_id: voice || 'default' },
        },
      ],
    };
    if (customMotion && customMotion.trim()) {
      payload.video_inputs[0].gesture = customMotion.trim();
    }

    const response = await axios.post(
      'https://api.heygen.com/v2/video/generate',
      payload,
      {
        headers: {
          'X-Api-Key': process.env.HEYGEN_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 60000,
        validateStatus: () => true,
      }
    );

    if (response.status < 200 || response.status >= 300) {
      return res.status(400).json({ success: false, error: response.data?.error?.message || `Video generate failed (${response.status})` });
    }
    const videoId = response.data?.data?.video_id || response.data?.video_id || response.data?.id;
    if (!videoId) {
      return res.status(400).json({ success: false, error: 'Failed to get video ID from response' });
    }

    return res.json({ success: true, videoId, message: 'Video generation started. Use videoId to check status.' });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.response?.data?.message || error.message || 'Failed to generate video' });
  }
};

const getVideoStatus = async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!videoId)
      return res.status(400).json({ success: false, error: 'Video ID is required' });
    if (!HEYGEN_API_KEY)
      return res.status(500).json({ success: false, error: 'HeyGen API key missing' });

    const statusResult = await checkVideoStatus(videoId);
    if (!statusResult.success)
      return res.status(400).json({ success: false, error: statusResult.error });

    return res.json({
      success: true,
      status: statusResult.status,
      videoUrl: statusResult.videoUrl,
      error: statusResult.error,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to check video status' });
  }
};

// New: route handler for checking video task status
const getVideoTaskStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!taskId)
      return res.status(400).json({ success: false, error: 'Task ID is required' });
    if (!HEYGEN_API_KEY)
      return res.status(500).json({ success: false, error: 'HeyGen API key missing' });

    const statusResult = await checkVideoTaskStatus(taskId);
    if (!statusResult.success)
      return res.status(400).json({ success: false, error: statusResult.error });

    return res.json({
      success: true,
      status: statusResult.status,
      videoId: statusResult.videoId,
      error: statusResult.error,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to check task status' });
  }
};

module.exports = { generateVideo, getVideoStatus, startAvatarGeneration, getAvatarGenerationStatus, generateVideoFromAvatar, getVideoTaskStatus };
