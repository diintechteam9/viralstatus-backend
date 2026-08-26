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

const callGroq = async (system, user, maxTokens = 1500) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const payload = { model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.8, response_format: { type: 'json_object' } };
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

// POST /api/review/generate
router.post('/generate', async (req, res) => {
  const { productName, productType = '', features = '', tone = 'Professional', rating = '5 Star', language = 'English', count = 3 } = req.body;
  if (!productName?.trim()) return res.status(400).json({ success: false, error: 'Product name is required' });

  const safeCount = Math.min(Math.max(Number(count) || 3, 1), 7);
  const system = `You are an expert at writing authentic, human-like product reviews that sound like real customers. Each review must be unique in voice, length, and perspective. Always respond in ${language}. Return valid JSON only.`;

  const user = `Generate ${safeCount} authentic ${tone.toLowerCase()} product reviews in ${language} for:
Product: "${productName}"
Category: ${productType || 'General Product'}
Key Features: ${features || 'standard product features'}
Rating: ${rating}

Return JSON:
{
  "reviews": [
    {
      "reviewer": "realistic Indian/local name matching the language",
      "title": "catchy review title (5-8 words)",
      "text": "detailed review body (3-5 sentences, natural language, mention specific features, personal experience)",
      "pros": "2-3 key positives as comma-separated string",
      "cons": "1-2 honest negatives or 'None' if 5 star"
    }
  ]
}

Rules:
- Each review must have a different writing style and perspective
- Use natural, conversational language — not marketing speak
- Include specific details about the product
- Make reviewer names realistic for ${language} speakers
- For lower ratings, include genuine complaints
- Generate exactly ${safeCount} reviews`;

  try {
    const raw = await callGroq(system, user, 1500);
    const parsed = extractJson(raw);
    if (!parsed?.reviews) return res.status(500).json({ success: false, error: 'Failed to parse response. Please try again.' });
    return res.json({ success: true, reviews: parsed.reviews });
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) return res.status(429).json({ success: false, error: 'Rate limit reached. Please wait a moment.' });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
