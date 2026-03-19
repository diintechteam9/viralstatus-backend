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
  const payload = { model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.5, response_format: { type: 'json_object' } };
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

router.post('/compare', async (req, res) => {
  const { product1, product2, category = 'General', language = 'English' } = req.body;
  if (!product1?.trim() || !product2?.trim()) return res.status(400).json({ success: false, error: 'Both product names are required' });

  const system = `You are a senior product analyst and consumer expert. You provide detailed, unbiased product comparisons based on real-world knowledge. Always respond in ${language}. Return valid JSON only.`;

  const user = `Compare these two ${category} products in ${language}: "${product1}" vs "${product2}".

Return JSON:
{
  "product1": "${product1}",
  "product2": "${product2}",
  "features": [
    {
      "feature": "feature/spec name",
      "product1Value": "value or description",
      "product2Value": "value or description",
      "winner": 1 or 2 or 0,
      "importance": "High/Medium/Low"
    }
  ],
  "pros1": ["pro 1", "pro 2", "pro 3"],
  "cons1": ["con 1", "con 2"],
  "pros2": ["pro 1", "pro 2", "pro 3"],
  "cons2": ["con 1", "con 2"],
  "verdict": "detailed verdict paragraph explaining which is better overall and why",
  "buyRecommendation": "who should buy product1 vs who should buy product2",
  "priceRange": "approximate price range for both if known"
}

Generate 10 comparison features. winner: 1=product1 wins, 2=product2 wins, 0=tie. Be specific and factual.`;

  try {
    const raw = await callGroq(system, user, 1500);
    const parsed = extractJson(raw);
    if (!parsed?.features) return res.status(500).json({ success: false, error: 'Failed to parse response. Please try again.' });
    return res.json({ success: true, ...parsed });
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) return res.status(429).json({ success: false, error: 'Rate limit reached. Please wait a moment.' });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
