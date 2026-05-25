const express = require('express');
const { generateOneImage, generateSixImages } = require('../utils/aiImageGenerate');

const router = express.Router();

// POST /api/image-proxy/generate-one — single image (for progressive UI)
router.post('/generate-one', async (req, res) => {
  const { prompt, index = 0 } = req.body;
  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ success: false, error: 'prompt required' });
  }

  try {
    const image = await generateOneImage(String(prompt).trim(), Number(index) || 0);
    res.json({ success: true, image });
  } catch (err) {
    console.error('[ImageProxy] generate-one failed:', err.message);
    res.json({
      success: false,
      image: {
        index: Number(index) || 0,
        success: false,
        data: null,
        pollinationsUrl: null,
        error: err.message,
      },
    });
  }
});

// POST /api/image-proxy/generate — all 6 (sequential, rate-limit safe)
router.post('/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ success: false, error: 'prompt required' });
  }

  try {
    const images = await generateSixImages(String(prompt).trim());
    const okCount = images.filter((i) => i.success).length;
    res.json({
      success: okCount > 0,
      images,
      message:
        okCount < 6
          ? `${okCount}/6 images generated. ${process.env.IMAGINEART_API_KEY ? '' : 'Add IMAGINEART_API_KEY or wait 15s between Pollinations calls.'}`
          : undefined,
    });
  } catch (err) {
    console.error('[ImageProxy] generate batch failed:', err.message);
    res.status(500).json({ success: false, error: err.message, images: [] });
  }
});

// GET /api/image-proxy — single image proxy (legacy)
router.get('/', async (req, res) => {
  const { prompt, index = 0 } = req.query;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  try {
    const image = await generateOneImage(String(prompt), Number(index) || 0);
    if (!image.success || !image.data) {
      return res.status(504).json({ error: image.error || 'Generation failed' });
    }
    const match = image.data.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return res.status(500).json({ error: 'Invalid image data' });
    const buffer = Buffer.from(match[2], 'base64');
    res.setHeader('Content-Type', match[1]);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    res.status(504).json({ error: err.message });
  }
});

module.exports = router;
