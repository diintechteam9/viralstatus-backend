const express = require('express');
const router = express.Router();
const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

const extractJson = (text) => {
  try { return JSON.parse(text); } catch (_) {}
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
    if (depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { return null; }
    }
  }
  return null;
};

const callGroq = async (system, user, maxTokens = 1200) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const payload = { model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.75, response_format: { type: 'json_object' } };
  try {
    const r = await axios.post(GROQ_URL, payload, { headers, timeout: 30000 });
    return r.data?.choices?.[0]?.message?.content || '';
  } catch (e) {
    if (e.response?.data?.error?.message?.toLowerCase().includes('failed')) {
      const r2 = await axios.post(GROQ_URL, { ...payload, response_format: undefined, temperature: 0.4 }, { headers, timeout: 30000 });
      return r2.data?.choices?.[0]?.message?.content || '';
    }
    throw e;
  }
};

// POST /api/reel/generate-script
router.post('/generate-script', async (req, res) => {
  const { topic, language = 'English', style = 'Motivational', duration = '30 sec', platform = 'Instagram Reels' } = req.body;
  if (!topic?.trim()) return res.status(400).json({ success: false, error: 'Topic is required' });

  const system = `You are a professional viral short-form video scriptwriter with 10+ years of experience creating content for ${platform}. You understand what makes videos go viral — strong hooks, emotional storytelling, and clear CTAs. Always respond in ${language}. Return valid JSON only.`;

  const user = `Write a complete ${style} reel script in ${language} for ${platform}.
Topic: "${topic}"
Duration: ${duration}

Return JSON with these exact keys:
{
  "hook": "A powerful 1-2 sentence opening that stops the scroll immediately. Make it curiosity-driven or shocking.",
  "script": "The full script with natural spoken dialogue. Include scene breaks with [SCENE] markers. Write exactly as it should be spoken. Match the ${duration} duration.",
  "cta": "A strong call-to-action line at the end (follow, share, comment, save).",
  "visualNotes": "Specific visual/editing suggestions: camera angles, text overlays, transitions, music mood, B-roll ideas.",
  "hashtags": "15-20 relevant hashtags as a single string separated by spaces"
}

Make the script feel natural, conversational, and platform-native for ${platform}. The hook must be the first 3 seconds.`;

  try {
    const raw = await callGroq(system, user, 1200);
    const parsed = extractJson(raw);
    if (!parsed?.script) return res.status(500).json({ success: false, error: 'Failed to parse response. Please try again.' });
    return res.json({ success: true, ...parsed });
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) return res.status(429).json({ success: false, error: 'Rate limit reached. Please wait a moment.' });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
