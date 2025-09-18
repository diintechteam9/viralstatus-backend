require('dotenv').config();
const { GoogleAuth } = require('google-auth-library');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const PROJECT_ID = process.env.GOOGLE_PROJECT_ID || 'viralstatus-464912';
const LOCATION = process.env.GOOGLE_LOCATION || 'us-central1';
const MODEL_ID = 'imagen-4.0-generate-preview-06-06';

async function getAccessToken() {
  // Use credentials from the environment variable
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({
    credentials,
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });
  const client = await auth.getClient();
  return await client.getAccessToken();
}

async function generateImageFromText(prompt, number_of_images = 1, aspect_ratio = "9:16") {
  const accessToken = await getAccessToken();
  const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predict`;
  
  const instance = {
    prompt,
    negative_prompt: "",
    person_generation: "allow_all",
    safety_filter_level: "block_few",
    add_watermark: true,
    // Remove aspect_ratio from instance - it should be in parameters
  };
  
  const body = {
    instances: [instance],
    parameters: {
      sampleCount: number_of_images,
      aspectRatio: aspect_ratio  // Move aspect_ratio to parameters and use camelCase
    }
  };
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken.token || accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('API Error:', errorText);
    throw new Error(`API Error: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  return data;
}

// Express handler: POST /api/generate-image
async function generateImage(req, res) {
  try {
    const {
      prompt,
      number_of_images = 1,
      aspect_ratio = '9:16'
    } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    const validAspectRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'];
    if (!validAspectRatios.includes(aspect_ratio)) {
      return res.status(400).json({
        success: false,
        error: `Invalid aspect ratio. Supported ratios: ${validAspectRatios.join(', ')}`
      });
    }

    const data = await generateImageFromText(prompt, number_of_images, aspect_ratio);

    if (!data.predictions || !data.predictions.length || !data.predictions[0].bytesBase64Encoded) {
      return res.status(500).json({
        success: false,
        error: 'No image generated'
      });
    }

    let images = [];
    const b64 = data.predictions[0].bytesBase64Encoded;
    if (Array.isArray(b64)) {
      images = b64.map((img) => `data:image/png;base64,${img}`);
    } else if (typeof b64 === 'string') {
      images = [`data:image/png;base64,${b64}`];
    }

    return res.json({
      success: true,
      images,
      prompt,
      aspect_ratio,
      model: MODEL_ID,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Image generation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Image generation failed',
      details: error.message
    });
  }
}

module.exports = { generateImage };