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

const callGroq = async (system, user, maxTokens = 2000) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const payload = { model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.7, response_format: { type: 'json_object' } };
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

router.post('/generate', async (req, res) => {
  const { destination, duration = '3 Days', travelStyle = 'Cultural', interests = '', language = 'English' } = req.body;
  if (!destination?.trim()) return res.status(400).json({ success: false, error: 'Destination is required' });

  const system = `You are an expert travel advisor and destination specialist with deep knowledge of global travel. You provide practical, experience-based travel recommendations. Always respond in ${language}. Return valid JSON only.`;

  const user = `Create a comprehensive ${travelStyle} travel guide for "${destination}" for ${duration} in ${language}.
Traveler interests: ${interests || 'general sightseeing, local culture, food'}.

Return JSON:
{
  "tripTitle": "catchy trip title",
  "overview": "3-4 sentence destination overview with key highlights",
  "bestTimeToVisit": "best season/months to visit",
  "days": [
    {
      "day": 1,
      "title": "day theme",
      "activities": ["specific activity with location", "activity 2", "activity 3", "activity 4"],
      "food": "must-try dish and recommended restaurant/area",
      "stay": "recommended accommodation type and area",
      "localTip": "one insider tip for this day"
    }
  ],
  "tips": ["practical tip 1", "tip 2", "tip 3", "tip 4", "tip 5"],
  "mustTry": ["must-try experience 1", "experience 2", "experience 3"],
  "avoid": ["common mistake to avoid"],
  "budget": "estimated budget range per person per day in INR/USD"
}
Generate one day object per day. Be specific with place names and activities.`;

  try {
    const raw = await callGroq(system, user, 2000);
    const parsed = extractJson(raw);
    if (!parsed?.days) return res.status(500).json({ success: false, error: 'Failed to parse response. Please try again.' });
    return res.json({ success: true, ...parsed });
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) return res.status(429).json({ success: false, error: 'Rate limit reached. Please wait a moment.' });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
