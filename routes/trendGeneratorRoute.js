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

const callGroq = async (system, user, maxTokens = 1500) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const payload = { model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.85, response_format: { type: 'json_object' } };
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

// POST /api/trend/generate-ideas
router.post('/generate-ideas', async (req, res) => {
  const { niche = 'Tech', platform = 'Instagram', keyword = '', language = 'English' } = req.body;

  const system = `You are a top social media trend analyst and viral content strategist. You have deep knowledge of what's trending on ${platform} right now. Always respond in ${language}. Return valid JSON only.`;

  const user = `Generate viral content ideas and trends for ${platform} in the ${niche} niche${keyword ? ` focused on "${keyword}"` : ''}.
Language: ${language}.

Return JSON:
{
  "trending": [
    { "topic": "trending topic name", "reason": "why it's trending right now" }
  ],
  "ideas": [
    {
      "title": "content idea title",
      "format": "Reel/Carousel/Post/Story",
      "hook": "opening hook for this idea",
      "viralScore": "High/Medium"
    }
  ],
  "hashtags": ["#hashtag1", "#hashtag2"],
  "bestTimeToPost": "best time to post on ${platform} for ${niche}",
  "contentTip": "one powerful platform-specific tip for ${niche} creators"
}

Generate: 5 trending topics with reasons, 8 content ideas with hooks and format, 15 hashtags.`;

  try {
    const raw = await callGroq(system, user, 1500);
    const parsed = extractJson(raw);
    if (!parsed?.ideas) return res.status(500).json({ success: false, error: 'Failed to parse response. Please try again.' });
    return res.json({ success: true, ...parsed });
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) return res.status(429).json({ success: false, error: 'Rate limit reached. Please wait a moment.' });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
