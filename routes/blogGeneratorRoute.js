const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authMiddleware: auth } = require('../middleware/authmiddleware');

// ─── Constants (loaded at module level - fixes lazy loading issue) ────────────
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`;
const UNSPLASH_SEARCH_URL = 'https://api.unsplash.com/search/photos';

// ─── Input limits ─────────────────────────────────────────────────────────────
const MAX_HEADING_LEN = 300;
const MAX_DESC_LEN = 2000;
const MAX_HTML_LEN = 500000; // 500KB max for modify
const MAX_REQUEST_LEN = 1000;
const MAX_QUERY_LEN = 100;
const MAX_COUNT = 10;

// ─── SSRF Guard: only allow safe plain-text search queries ───────────────────
function sanitizeSearchQuery(query) {
  if (typeof query !== 'string') return null;
  const trimmed = query.trim().slice(0, MAX_QUERY_LEN);
  // Allow only alphanumeric, spaces, hyphens — block any URL/protocol injection
  if (!/^[a-zA-Z0-9\s\-]+$/.test(trimmed)) return null;
  return trimmed;
}

// ─── Sanitize plain text inputs (strip HTML/script tags) ─────────────────────
function sanitizeText(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

// ─── Validate hex color ───────────────────────────────────────────────────────
function sanitizeColor(color) {
  if (typeof color !== 'string') return '#f97316';
  return /^#[0-9a-fA-F]{3,6}$/.test(color.trim()) ? color.trim() : '#f97316';
}

// ─── Gemini API call ──────────────────────────────────────────────────────────
async function callGemini(key, prompt, temperature = 0.8, maxTokens = 16384) {
  const res = await axios.post(
    `${GEMINI_ENDPOINT}?key=${key}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    },
    { timeout: 120000 }
  );
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── Auth middleware applied to all blog routes (fixes CSRF) ─────────────────
router.use(auth);

// ─── POST /api/blog/generate ──────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const heading = sanitizeText(req.body.heading, MAX_HEADING_LEN);
  const description = sanitizeText(req.body.description, MAX_DESC_LEN);
  const category = sanitizeText(req.body.category || 'General', 50);
  const tone = sanitizeText(req.body.tone || 'Professional', 50);
  const language = sanitizeText(req.body.language || 'English', 50);
  const primaryColor = sanitizeColor(req.body.primaryColor);
  const secondaryColor = sanitizeColor(req.body.secondaryColor);
  const images = Array.isArray(req.body.images) ? req.body.images.slice(0, 10) : [];

  if (!heading || !description) {
    return res.status(400).json({ success: false, error: 'Heading and description are required' });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(500).json({ success: false, error: 'GEMINI_API_KEY not configured on server' });
  }

  // Only use image URLs from trusted Unsplash/picsum domains
  const trustedImageDomains = ['images.unsplash.com', 'picsum.photos'];
  const safeImages = images.filter((img) => {
    try {
      const host = new URL(img.url).hostname;
      return trustedImageDomains.some((d) => host.endsWith(d));
    } catch {
      return false;
    }
  });

  const imageSection = safeImages.length
    ? `Use these real images in the blog:\n${safeImages.map((img, i) => `Image ${i + 1}: ${img.url} (alt: ${sanitizeText(img.alt, 100)})`).join('\n')}`
    : '';

  const prompt = `You are an expert blog writer and web developer. Generate a complete, beautiful, single-file HTML blog post.

Blog Details:
- Heading: ${heading}
- Description: ${description}
- Category: ${category}
- Tone: ${tone}
- Language: ${language}
- Primary Color: ${primaryColor}
- Secondary Color: ${secondaryColor}
${imageSection}

REQUIREMENTS:
1. Complete single HTML file with all CSS in <style> and JS in <script>
2. Dark theme background: #0a0a0f
3. Google Font: Inter (import from Google Fonts)
4. CSS Variables: --primary: ${primaryColor}; --secondary: ${secondaryColor}
5. Author section with Indian name and randomuser.me photo
6. Estimated reading time
7. Table of Contents with smooth scroll anchor links
8. 5-7 detailed content sections with proper headings
9. Card-based sections: Key Takeaways, Pro Tips, Did You Know, Step-by-Step
10. Reading progress bar at top (JS)
11. Back to Top button (JS)
12. Like button with heart animation (JS)
13. Comments section with form (JS - store in localStorage)
14. Social share footer
15. Fully responsive (mobile media queries)
16. Smooth scroll behavior
17. No external CSS/JS files (only Google Fonts CDN allowed)
18. Output ONLY the HTML file, no explanation, no markdown

Return ONLY the complete HTML starting with <!DOCTYPE html>`;

  try {
    const raw = await callGemini(geminiKey, prompt, 0.8, 16384);
    return res.json({ success: true, html: raw });
  } catch (e) {
    console.error('[BlogGenerator] generate error:', e.message);
    return res.status(500).json({ success: false, error: e.response?.data?.error?.message || e.message });
  }
});

// ─── POST /api/blog/modify ────────────────────────────────────────────────────
router.post('/modify', async (req, res) => {
  // Do NOT sanitize currentHTML with sanitizeText — it strips all HTML tags
  const currentHTML = typeof req.body.currentHTML === 'string'
    ? req.body.currentHTML.slice(0, MAX_HTML_LEN)
    : '';
  const userRequest = sanitizeText(req.body.userRequest, MAX_REQUEST_LEN);

  if (!currentHTML || !userRequest) {
    return res.status(400).json({ success: false, error: 'currentHTML and userRequest are required' });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(500).json({ success: false, error: 'GEMINI_API_KEY not configured on server' });
  }

  const prompt = `You are an expert web developer. Modify the following HTML blog post based on the user's request.

User Request: "${userRequest}"

Current HTML:
${currentHTML}

RULES:
- Return the COMPLETE modified HTML file
- Keep all existing styles and functionality
- Only change what the user requested
- Output ONLY the HTML, no explanation

Return ONLY the complete HTML starting with <!DOCTYPE html>`;

  try {
    const raw = await callGemini(geminiKey, prompt, 0.7, 16384);
    return res.json({ success: true, html: raw });
  } catch (e) {
    console.error('[BlogGenerator] modify error:', e.message);
    return res.status(500).json({ success: false, error: e.response?.data?.error?.message || e.message });
  }
});

// ─── POST /api/blog/suggestions ──────────────────────────────────────────────
router.post('/suggestions', async (req, res) => {
  const heading = sanitizeText(req.body.heading, MAX_HEADING_LEN);

  if (!heading) {
    return res.status(400).json({ success: false, error: 'Heading is required' });
  }

  const geminiKey2 = process.env.GEMINI_API_KEY_2;
  if (!geminiKey2) {
    return res.status(500).json({ success: false, error: 'GEMINI_API_KEY_2 not configured on server' });
  }

  const prompt = `Generate 6 creative blog description suggestions for the heading: "${heading}".
Return ONLY a JSON array of 6 strings, no explanation. Example: ["desc1","desc2","desc3","desc4","desc5","desc6"]`;

  try {
    const raw = await callGemini(geminiKey2, prompt, 0.8, 1024);
    const match = raw.match(/\[[\s\S]*\]/);
    const suggestions = match ? JSON.parse(match[0]) : [];
    return res.json({ success: true, suggestions });
  } catch (e) {
    console.error('[BlogGenerator] suggestions error:', e.message);
    return res.status(500).json({ success: false, error: e.message, suggestions: [] });
  }
});

// ─── POST /api/blog/image-search-term ────────────────────────────────────────
router.post('/image-search-term', async (req, res) => {
  const description = sanitizeText(req.body.description, MAX_DESC_LEN);

  if (!description) {
    return res.status(400).json({ success: false, error: 'Description is required' });
  }

  const geminiKey2 = process.env.GEMINI_API_KEY_2;
  if (!geminiKey2) {
    const term = description.split(' ').slice(0, 3).join(' ');
    return res.json({ success: true, term });
  }

  const prompt = `Convert this blog heading/description into a 1-3 word Unsplash search query. Return ONLY the search query, nothing else.\nDescription: "${description}"`;

  try {
    const raw = await callGemini(geminiKey2, prompt, 0.5, 50);
    // Sanitize the AI-returned search term before using it
    const term = sanitizeSearchQuery(raw) || description.split(' ').slice(0, 3).join(' ');
    return res.json({ success: true, term });
  } catch (e) {
    const term = description.split(' ').slice(0, 3).join(' ');
    return res.json({ success: true, term });
  }
});

// ─── GET /api/blog/unsplash-images ───────────────────────────────────────────
router.get('/unsplash-images', async (req, res) => {
  // SSRF fix: sanitize query — only allow safe alphanumeric search terms
  const query = sanitizeSearchQuery(req.query.query);
  const count = Math.min(Math.max(parseInt(req.query.count) || 5, 1), MAX_COUNT);

  if (!query) {
    return res.status(400).json({ success: false, error: 'Invalid or missing query parameter' });
  }

  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!unsplashKey) {
    return res.status(500).json({ success: false, error: 'UNSPLASH_ACCESS_KEY not configured on server' });
  }

  try {
    const page = Math.floor(Math.random() * 5) + 1;
    const response = await axios.get(UNSPLASH_SEARCH_URL, {
      params: { query, per_page: count, page, orientation: 'landscape' },
      headers: { Authorization: `Client-ID ${unsplashKey}` },
      timeout: 15000,
    });

    let results = response.data?.results || [];

    if (!results.length) {
      const r2 = await axios.get(UNSPLASH_SEARCH_URL, {
        params: { query, per_page: count, page: 1, orientation: 'landscape' },
        headers: { Authorization: `Client-ID ${unsplashKey}` },
        timeout: 15000,
      });
      results = r2.data?.results || [];
    }

    const images = results.map((img) => ({
      url: img.urls?.regular || '',
      urlSmall: img.urls?.small || '',
      urlFull: img.urls?.full || '',
      alt: img.alt_description || img.description || 'Blog image',
      photographer: img.user?.name || '',
    }));

    return res.json({ success: true, images });
  } catch (e) {
    console.error('[BlogGenerator] Unsplash error:', e.message);
    const fallbacks = Array.from({ length: count }, (_, i) => ({
      url: `https://picsum.photos/seed/${Date.now() + i}/800/450`,
      urlSmall: `https://picsum.photos/seed/${Date.now() + i}/400/225`,
      urlFull: `https://picsum.photos/seed/${Date.now() + i}/1200/675`,
      alt: 'Blog image',
      photographer: '',
    }));
    return res.json({ success: true, images: fallbacks });
  }
});

module.exports = router;
