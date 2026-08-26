const express = require('express');
const router = express.Router();
const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-70b-versatile';

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
  const payload = { model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.6, response_format: { type: 'json_object' } };
  try {
    const r = await axios.post(GROQ_URL, payload, { headers, timeout: 30000 });
    return r.data?.choices?.[0]?.message?.content || '';
  } catch (e) {
    if (e.response?.data?.error?.message?.toLowerCase().includes('failed')) {
      const r2 = await axios.post(GROQ_URL, { ...payload, response_format: undefined, temperature: 0.3 }, { headers, timeout: 30000 });
      return r2.data?.choices?.[0]?.message?.content || '';
    }
    throw e;
  }
};

// POST /api/infographic/generate
router.post('/generate', async (req, res) => {
  const { topic, type = 'Statistics', language = 'English' } = req.body;
  if (!topic?.trim()) return res.status(400).json({ success: false, error: 'Topic is required' });

  const system = `You are an expert infographic content designer and data researcher. You create visually structured, fact-rich infographic content. Always respond in ${language}. Return valid JSON only.`;

  const user = `Create a "${type}" style infographic in ${language} about: "${topic}".

Return JSON:
{
  "title": "compelling infographic title",
  "subtitle": "one-line supporting subtitle",
  "points": [
    {
      "label": "point heading or stat label",
      "value": "the data, fact, or description (specific and impactful)",
      "icon": "relevant emoji for this point"
    }
  ],
  "keyTakeaway": "one powerful summary sentence",
  "source": "mention 'AI Generated' or relevant source"
}

Generate 7-8 data points. Make each point specific, factual, and visually impactful. Use real-sounding statistics where appropriate for ${type} type.`;

  try {
    const raw = await callGroq(system, user, 1200);
    const parsed = extractJson(raw);
    if (!parsed?.points) return res.status(500).json({ success: false, error: 'Failed to parse response. Please try again.' });
    return res.json({ success: true, ...parsed });
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) return res.status(429).json({ success: false, error: 'Rate limit reached. Please wait a moment.' });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
