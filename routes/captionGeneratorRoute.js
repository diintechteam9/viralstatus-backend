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

// POST /api/caption/generate
router.post('/generate', async (req, res) => {
  const { topic, platform = 'Instagram', tone = 'Witty', language = 'English' } = req.body;
  if (!topic?.trim()) return res.status(400).json({ success: false, error: 'Topic is required' });

  const system = `You are a viral social media copywriter who has written captions for top influencers and brands. You know exactly what makes people stop scrolling, engage, and share. Always respond in ${language}. Return valid JSON only.`;

  const user = `Generate high-converting captions and scroll-stopping hooks for ${platform} in ${language}.
Topic/Post Idea: "${topic}"
Tone: ${tone}

Return JSON:
{
  "hooks": [
    { "text": "hook line", "type": "Question/Statement/Controversial/Story/Statistic" }
  ],
  "captions": [
    {
      "text": "full caption with emojis, line breaks, and natural flow",
      "length": "Short/Medium/Long",
      "style": "caption style description"
    }
  ],
  "hashtags": ["#tag1", "#tag2"],
  "ctaSuggestions": ["CTA option 1", "CTA option 2", "CTA option 3"]
}

Generate: 4 hooks (different types), 3 captions (short/medium/long), 15 hashtags, 3 CTA suggestions.
Captions must feel authentic, not corporate. Use emojis naturally.`;

  try {
    const raw = await callGroq(system, user, 1500);
    const parsed = extractJson(raw);
    if (!parsed?.hooks) return res.status(500).json({ success: false, error: 'Failed to parse response. Please try again.' });
    return res.json({ success: true, ...parsed });
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) return res.status(429).json({ success: false, error: 'Rate limit reached. Please wait a moment.' });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
