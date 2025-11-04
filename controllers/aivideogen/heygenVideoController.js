require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');

const HEYGEN_BASE_URL = 'https://api.heygen.com/v1';
const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;

/**
 * Upload image to HeyGen and get image URL
 */
async function uploadImageToHeyGen(imageBase64) {
  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const formData = new FormData();
    formData.append('file', imageBuffer, { 
      filename: 'image.jpg', 
      contentType: 'image/jpeg' 
    });

    const response = await axios({
      method: 'post',
      url: `${HEYGEN_BASE_URL}/image/upload`,
      headers: {
        'X-Api-Key': HEYGEN_API_KEY,
        ...formData.getHeaders()
      },
      data: formData,
      timeout: 60000,
    });

    // Handle different response formats
    const imageUrl = response.data?.data?.image_url || 
                     response.data?.image_url || 
                     response.data?.data?.url ||
                     response.data?.url;
    
    if (imageUrl) {
      return { success: true, imageUrl };
    }
    
    console.error('HeyGen upload response:', JSON.stringify(response.data, null, 2));
    return { success: false, error: 'Failed to get image URL from HeyGen response' };
  } catch (error) {
    console.error('HeyGen image upload error:', error.response?.data || error.message);
    return { 
      success: false, 
      error: error.response?.data?.message || error.message || 'Failed to upload image to HeyGen' 
    };
  }
}

/**
 * Generate video using HeyGen API
 */
async function generateVideoWithHeyGen(imageUrl, script, customMotion, voiceId) {
  try {
    const payload = {
      video_inputs: [
        {
          character: {
            type: 'image',
            image_url: imageUrl
          },
          voice: {
            type: 'text',
            input_text: script,
            voice_id: voiceId || 'default'
          }
        }
      ]
    };

    // Add motion/gesture if custom motion is provided
    if (customMotion && customMotion.trim()) {
      payload.video_inputs[0].gesture = customMotion.trim();
    }

    const response = await axios({
      method: 'post',
      url: `${HEYGEN_BASE_URL}/video/generate`,
      headers: {
        'X-Api-Key': HEYGEN_API_KEY,
        'Content-Type': 'application/json'
      },
      data: payload,
      timeout: 60000,
    });

    // Handle different response formats
    const videoId = response.data?.data?.video_id || 
                    response.data?.video_id || 
                    response.data?.data?.id ||
                    response.data?.id;
    
    if (videoId) {
      return { 
        success: true, 
        videoId 
      };
    }
    
    console.error('HeyGen generation response:', JSON.stringify(response.data, null, 2));
    return { success: false, error: 'Failed to get video ID from HeyGen response' };
  } catch (error) {
    console.error('HeyGen video generation error:', error.response?.data || error.message);
    return { 
      success: false, 
      error: error.response?.data?.message || error.message || 'Failed to generate video' 
    };
  }
}

/**
 * Check video generation status
 */
async function checkVideoStatus(videoId) {
  try {
    const response = await axios({
      method: 'get',
      url: `${HEYGEN_BASE_URL}/video_status.get?video_id=${videoId}`,
      // Alternative endpoint format: `${HEYGEN_BASE_URL}/video/${videoId}/status`
      headers: {
        'X-Api-Key': HEYGEN_API_KEY
      },
      timeout: 30000,
    });

    // Handle different response formats
    const data = response.data?.data || response.data || {};
    
    if (data) {
      return {
        success: true,
        status: data.status || data.state || 'processing',
        videoUrl: data.video_url || data.url || data.videoUrl || null,
        error: data.error || data.error_message || null
      };
    }
    
    console.error('HeyGen status response:', JSON.stringify(response.data, null, 2));
    return { success: false, error: 'Invalid response from HeyGen' };
  } catch (error) {
    console.error('HeyGen status check error:', error.response?.data || error.message);
    return { 
      success: false, 
      error: error.response?.data?.message || error.message || 'Failed to check video status' 
    };
  }
}

/**
 * Main controller to generate video
 */
const generateVideo = async (req, res) => {
  try {
    const { image_base64, script, customMotion, voice } = req.body;

    // Validation
    if (!image_base64) {
      return res.status(400).json({ 
        success: false,
        error: 'Image is required' 
      });
    }

    if (!script || !script.trim()) {
      return res.status(400).json({ 
        success: false,
        error: 'Script is required' 
      });
    }

    if (!HEYGEN_API_KEY) {
      return res.status(500).json({ 
        success: false,
        error: 'HeyGen API key not configured' 
      });
    }

    // Step 1: Upload image to HeyGen
    console.log('Uploading image to HeyGen...');
    const uploadResult = await uploadImageToHeyGen(image_base64);
    if (!uploadResult.success) {
      return res.status(400).json({ 
        success: false,
        error: uploadResult.error 
      });
    }

    // Step 2: Generate video
    console.log('Generating video with HeyGen...');
    const defaultVoiceId = voice || 'default';
    const generateResult = await generateVideoWithHeyGen(
      uploadResult.imageUrl, 
      script.trim(), 
      customMotion || '', 
      defaultVoiceId
    );

    if (!generateResult.success) {
      return res.status(400).json({ 
        success: false,
        error: generateResult.error 
      });
    }

    // Return video ID for polling
    return res.json({
      success: true,
      videoId: generateResult.videoId,
      message: 'Video generation started. Use the videoId to check status.'
    });
  } catch (error) {
    console.error('Generate video error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to generate video' 
    });
  }
};

/**
 * Controller to check video status
 */
const getVideoStatus = async (req, res) => {
  try {
    const { videoId } = req.params;

    if (!videoId) {
      return res.status(400).json({ 
        success: false,
        error: 'Video ID is required' 
      });
    }

    if (!HEYGEN_API_KEY) {
      return res.status(500).json({ 
        success: false,
        error: 'HeyGen API key not configured' 
      });
    }

    const statusResult = await checkVideoStatus(videoId);
    if (!statusResult.success) {
      return res.status(400).json({ 
        success: false,
        error: statusResult.error 
      });
    }

    return res.json({
      success: true,
      status: statusResult.status,
      videoUrl: statusResult.videoUrl,
      error: statusResult.error
    });
  } catch (error) {
    console.error('Get video status error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to check video status' 
    });
  }
};

module.exports = { generateVideo, getVideoStatus };

