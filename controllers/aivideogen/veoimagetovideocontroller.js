require('dotenv').config();
const { GoogleAuth } = require('google-auth-library');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const PROJECT_ID = process.env.GOOGLE_PROJECT_ID || 'viralstatus-464912';
const LOCATION = process.env.GOOGLE_LOCATION || 'us-central1';
const DEFAULT_MODEL_ID = process.env.GOOGLE_VEO_MODEL_ID || 'veo-2.0-generate-001';
const API_ENDPOINT = `${LOCATION}-aiplatform.googleapis.com`;

async function getAccessToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({
    credentials,
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });
  const client = await auth.getClient();
  return await client.getAccessToken();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadImageAsBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Failed to download image: ${resp.status} ${txt}`);
  }
  const contentType = resp.headers.get('content-type') || 'image/jpeg';
  const arrayBuffer = await resp.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  return { base64, contentType };
}

async function startVeoImageToVideoJob({ prompt, image, parameters, modelId = DEFAULT_MODEL_ID }) {
  const accessToken = await getAccessToken();
  const url = `https://${API_ENDPOINT}/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelId}:predictLongRunning`;

  const body = {
    instances: [
      {
        prompt,
        image,
      },
    ],
    parameters,
  };

  try {
    console.log('[VEO] Starting LRO', {
      modelId,
      promptPreview: (prompt || '').slice(0, 80),
      imageHasBase64: Boolean(image && image.bytesBase64Encoded),
      imageBase64Size: image && image.bytesBase64Encoded ? image.bytesBase64Encoded.length : 0,
      imageMimeType: image && image.mimeType,
      imageGcsUri: image && image.gcsUri,
      parameters,
    });
  } catch {}

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken.token || accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VEO LRO start failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  if (!data.name) {
    throw new Error('Operation name not returned by VEO');
  }
  console.log('[VEO] LRO started', { operationName: data.name, modelId });
  return { operationName: data.name, modelId };
}

async function pollOperationFetch(modelId, operationName, timeoutMs = 300000, intervalMs = 3000) {
  const accessToken = await getAccessToken();
  const end = Date.now() + timeoutMs;
  const url = `https://${API_ENDPOINT}/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelId}:fetchPredictOperation`;
  while (Date.now() < end) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.token || accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operationName }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Polling failed: ${resp.status} ${txt}`);
    }
    const op = await resp.json();
    const respPreds = Array.isArray(op?.predictions) ? op.predictions : Array.isArray(op?.response?.predictions) ? op.response.predictions : [];
    const statusField = op?.status || op?.state || op?.response?.status || op?.response?.state;
    try {
      const status = typeof op?.done !== 'undefined' ? (op.done ? 'done' : 'running') : (statusField || 'unknown');
      const predCount = Array.isArray(respPreds) ? respPreds.length : 0;
      const firstKeys = respPreds && respPreds[0] ? Object.keys(respPreds[0]) : [];
      console.log('[VEO] Poll tick', { modelId, operationName, status, predCount, firstPredictionKeys: firstKeys });
    } catch {}

    if (op?.error) {
      throw new Error(`VEO operation error: ${op.error.message || JSON.stringify(op.error)}`);
    }

    // Some versions return predictions at top-level; others under response
    if (Array.isArray(op?.predictions)) {
      return op; // return object with predictions
    }
    if (Array.isArray(op?.response?.predictions)) {
      return op.response; // return response with predictions
    }
    await sleep(intervalMs);
  }
  throw new Error('VEO operation timed out');
}

// Express handler: POST /api/aivideo/veo-image-to-video
// Body: { prompt: string, imageUrl?: string, imageBase64?: string, aspect_ratio?: string, durationSeconds?: string|number, resolution?: string, sampleCount?: number, generateAudio?: boolean }
async function veoImageToVideo(req, res) {
  try {
    const {
      prompt,
      imageUrl,
      imageBase64,
      imageMimeType,
      aspect_ratio = '9:16',
      durationSeconds = '5',
      resolution = '720p',
      sampleCount = 1,
      generateAudio = false,
      personGeneration = 'allow_all',
      addWatermark = true,
      includeRaiReason = true,
      modelId,
    } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'prompt is required' });
    }
    if (!imageUrl && !imageBase64) {
      return res.status(400).json({ success: false, error: 'Provide imageUrl (GCS/HTTP) or imageBase64' });
    }

    const validAspectRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'];
    if (!validAspectRatios.includes(aspect_ratio)) {
      return res.status(400).json({ success: false, error: `Invalid aspect_ratio. Supported: ${validAspectRatios.join(', ')}` });
    }

    let image = undefined;
    if (imageBase64) {
      image = { bytesBase64Encoded: imageBase64, mimeType: imageMimeType || 'image/jpeg' };
    } else if (imageUrl) {
      if (imageUrl.startsWith('gs://')) {
        image = { gcsUri: imageUrl };
      } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        const { base64, contentType } = await downloadImageAsBase64(imageUrl);
        image = { bytesBase64Encoded: base64, mimeType: contentType || 'image/jpeg' };
      } else {
        return res.status(400).json({ success: false, error: 'imageUrl must be gs://, http:// or https://' });
      }
    }

    const parameters = {
      aspectRatio: aspect_ratio,
      sampleCount: Number(sampleCount) || 1,
      durationSeconds: String(durationSeconds),
      personGeneration,
      addWatermark: Boolean(addWatermark),
      includeRaiReason: Boolean(includeRaiReason),
      // Disable audio to avoid model errors (can be enabled for supported models)
      generateAudio: false,
      resolution,
    };

    const { operationName, modelId: usedModel } = await startVeoImageToVideoJob({ prompt, image, parameters, modelId });
    const response = await pollOperationFetch(usedModel || DEFAULT_MODEL_ID, operationName);

    // Parse predictions with broader schema support
    let videos = [];
    const preds = Array.isArray(response?.predictions)
      ? response.predictions
      : Array.isArray(response?.response?.predictions)
      ? response.response.predictions
      : [];
    const toDataUrl = (b64) => `data:video/mp4;base64,${b64}`;

    const collectFromObject = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      // Common fields
      if (typeof obj.bytesBase64Encoded === 'string') {
        videos.push(toDataUrl(obj.bytesBase64Encoded));
      }
      if (Array.isArray(obj.bytesBase64Encoded)) {
        obj.bytesBase64Encoded.forEach((b) => videos.push(toDataUrl(b)));
      }
      if (Array.isArray(obj.mediaUris)) {
        obj.mediaUris.forEach((u) => videos.push(u));
      }
      if (typeof obj.gcsUri === 'string') {
        videos.push(obj.gcsUri);
      }
      // Alternative nests
      if (Array.isArray(obj.videos)) {
        obj.videos.forEach(collectFromObject);
      }
      if (obj.video) {
        collectFromObject(obj.video);
      }
      if (Array.isArray(obj.files)) {
        obj.files.forEach((f) => {
          if (f && (f.mimeType === 'video/mp4' || f.mimeType === 'video/mpeg' || !f.mimeType)) {
            collectFromObject(f);
          }
        });
      }
      if (obj.output) {
        collectFromObject(obj.output);
      }
      if (Array.isArray(obj.outputs)) {
        obj.outputs.forEach(collectFromObject);
      }
    };

    if (Array.isArray(preds) && preds.length > 0) {
      try {
        console.log('[VEO] Parsing predictions', {
          predictionsCount: preds.length,
          firstPredictionKeys: Object.keys(preds[0] || {}),
        });
      } catch {}
      preds.forEach(collectFromObject);
    }

    if (!videos.length) {
      // Return raw response for debugging when no videos parsed
      console.warn('[VEO] No videos parsed from response; returning raw for debugging');
      return res.status(200).json({ success: false, error: 'No video returned by VEO', raw: response });
    }

    return res.json({
      success: true,
      videos,
      prompt,
      aspect_ratio,
      model: usedModel || DEFAULT_MODEL_ID,
      operation: operationName,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('VEO image-to-video error:', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, error: 'VEO image-to-video failed', details: error.message });
  }
}

module.exports = { veoImageToVideo };


