const https = require('https');
const axios = require('axios');
const FormData = require('form-data');

const STYLES = [
  'photorealistic',
  'digital art',
  'cinematic lighting',
  'minimalist clean',
  'vibrant colorful',
  'professional corporate',
];

const RATE_LIMIT_PLACEHOLDER_MD5 = '2090a5dc21c32952cbf8496339752bd1';
const POLLINATIONS_MIN_GAP_MS = 15000;
let lastPollinationsAt = 0;
let imagineArtDisabledReason = null;

function isImagineArtEnabled() {
  if (imagineArtDisabledReason) return false;
  return process.env.IMAGINEART_COVER_ENABLED === 'true';
}

function disableImagineArt(reason) {
  if (!imagineArtDisabledReason) {
    imagineArtDisabledReason = reason;
    console.warn('[aiImage] ImagineArt disabled for cover images:', reason, '— using Pollinations.');
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildStyledPrompt(prompt, style) {
  const base = String(prompt).replace(/\s+/g, ' ').trim().slice(0, 500);
  const s = style || 'high quality professional';
  return `${base}, ${s}, sharp focus, no text watermark, blog cover image`;
}

function getPollinationsUrl(prompt, seed) {
  const key = process.env.POLLINATIONS_API_KEY;
  const encoded = encodeURIComponent(prompt);
  if (key) {
    return `https://gen.pollinations.ai/image/${encoded}?width=800&height=500&seed=${seed}&nologo=true&model=flux&key=${key}`;
  }
  return `https://image.pollinations.ai/prompt/${encoded}?seed=${seed}&width=800&height=500&nologo=true&model=flux`;
}

function fetchUrlAsBuffer(url, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : require('http');
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'image/jpeg,image/png,image/webp,image/*,*/*',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrlAsBuffer(res.headers.location, timeoutMs).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        const contentType = res.headers['content-type'] || 'image/jpeg';
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (buffer.length < 5000) {
            return reject(new Error('Response too small — not a valid image'));
          }
          const crypto = require('crypto');
          const md5 = crypto.createHash('md5').update(buffer).digest('hex');
          if (md5 === RATE_LIMIT_PLACEHOLDER_MD5) {
            return reject(new Error('Pollinations rate limit — wait and retry'));
          }
          resolve({ buffer, contentType, url });
        });
        res.on('error', reject);
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout after ${timeoutMs / 1000}s`));
    });
    req.on('error', reject);
  });
}

function decodeVyroError(data) {
  if (!data) return '';
  if (Buffer.isBuffer(data)) return data.toString('utf8').slice(0, 300);
  if (typeof data === 'string') return data;
  return JSON.stringify(data);
}

async function generateViaImagineArt(prompt, styleLabel, seed) {
  const apiKey = process.env.IMAGINEART_API_KEY;
  if (!apiKey || !isImagineArtEnabled()) return null;

  const cleanedPrompt = buildStyledPrompt(prompt, styleLabel).slice(0, 700);
  const seedStr = String(Math.min(Math.max(parseInt(seed, 10) || 5, 1), 999999));

  // Vyro docs: prompt, style, aspect_ratio, seed — no variation (API rejects variation=1)
  const formData = new FormData();
  formData.append('prompt', cleanedPrompt);
  formData.append('style', 'realistic');
  formData.append('aspect_ratio', '16:9');
  formData.append('seed', seedStr);

  try {
    const response = await axios.post('https://api.vyro.ai/v2/image/generations', formData, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
      responseType: 'arraybuffer',
      timeout: 180000,
      maxContentLength: 20 * 1024 * 1024,
      validateStatus: () => true,
    });

    if (response.status >= 400) {
      const msg = decodeVyroError(response.data);
      if (/invalid variation|variation is a required/i.test(msg)) {
        disableImagineArt('Vyro API variation parameter incompatible — set IMAGINEART_COVER_ENABLED=false or update API plan');
      }
      throw new Error(msg || `HTTP ${response.status}`);
    }

    const buffer = Buffer.from(response.data);
    if (buffer.length < 5000) {
      throw new Error('ImagineArt returned empty image');
    }
    return {
      buffer,
      contentType: 'image/jpeg',
      url: null,
      source: 'imagineart',
    };
  } catch (err) {
    const msg = err.response ? decodeVyroError(err.response.data) : err.message;
    if (/invalid variation|variation is a required/i.test(msg)) {
      disableImagineArt(msg);
    }
    throw new Error(msg || err.message);
  }
}

async function waitForPollinationsSlot() {
  const elapsed = Date.now() - lastPollinationsAt;
  const wait = POLLINATIONS_MIN_GAP_MS - elapsed;
  if (wait > 0) await sleep(wait);
}

async function generateViaPollinations(prompt, seed, attempt = 1) {
  await waitForPollinationsSlot();
  const url = getPollinationsUrl(prompt, seed);
  try {
    const result = await fetchUrlAsBuffer(url, 120000);
    lastPollinationsAt = Date.now();
    return { ...result, source: 'pollinations', pollinationsUrl: url };
  } catch (err) {
    if (attempt < 3) {
      await sleep(attempt * 5000);
      return generateViaPollinations(prompt, seed + attempt, attempt + 1);
    }
    throw err;
  }
}

/**
 * Generate one cover image (ImagineArt if configured, else Pollinations).
 */
async function generateOneImage(prompt, index = 0) {
  const style = STYLES[index % STYLES.length];
  const styledPrompt = buildStyledPrompt(prompt, style);
  const seed = Math.floor(Math.random() * 999999) + index + 1;

  if (isImagineArtEnabled()) {
    try {
      const result = await generateViaImagineArt(prompt, style, seed);
      if (result) return formatImageResult(result, index, style);
    } catch (err) {
      console.warn(`[aiImage] ImagineArt ${index + 1}:`, err.message);
    }
  }

  const result = await generateViaPollinations(styledPrompt, seed);
  return formatImageResult(result, index, style);
}

function formatImageResult({ buffer, contentType, url, pollinationsUrl, source }, index, style) {
  const mime = (contentType || 'image/jpeg').split(';')[0];
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  return {
    index,
    success: true,
    data: dataUrl,
    pollinationsUrl: pollinationsUrl || url || null,
    style,
    source,
  };
}

/**
 * Generate 6 images sequentially with provider-appropriate delays.
 */
async function generateSixImages(prompt, onProgress) {
  const images = [];
  const delayMs = isImagineArtEnabled() ? 2000 : 15000;

  for (let i = 0; i < 6; i++) {
    if (i > 0) await sleep(delayMs);

    try {
      const img = await generateOneImage(prompt, i);
      images.push(img);
      if (onProgress) onProgress(img);
      console.log(`[aiImage] ${i + 1}/6 OK (${img.source})`);
    } catch (err) {
      console.error(`[aiImage] ${i + 1}/6 FAILED:`, err.message);
      images.push({
        index: i,
        success: false,
        data: null,
        pollinationsUrl: null,
        error: err.message,
      });
      if (onProgress) onProgress(images[images.length - 1]);
    }
  }

  return images;
}

module.exports = {
  STYLES,
  generateOneImage,
  generateSixImages,
  buildStyledPrompt,
};
