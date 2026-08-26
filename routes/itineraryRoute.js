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

const callGroq = async (system, user, maxTokens = 2500) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const payload = { model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.65, response_format: { type: 'json_object' } };
  try {
    const r = await axios.post(GROQ_URL, payload, { headers, timeout: 35000 });
    return r.data?.choices?.[0]?.message?.content || '';
  } catch (e) {
    if (e.response?.data?.error?.message?.toLowerCase().includes('failed')) {
      const r2 = await axios.post(GROQ_URL, { ...payload, response_format: undefined, temperature: 0.3 }, { headers, timeout: 35000 });
      return r2.data?.choices?.[0]?.message?.content || '';
    }
    throw e;
  }
};

router.post('/generate', async (req, res) => {
  const { destination, startCity = '', duration = '5 Days', tripType = 'Leisure', budget = 'Mid-range', groupSize = '2', language = 'English' } = req.body;
  if (!destination?.trim()) return res.status(400).json({ success: false, error: 'Destination is required' });

  const system = `You are a professional travel planner with 15+ years of experience creating detailed itineraries. You provide practical, time-specific, budget-aware travel plans. Always respond in ${language}. Return valid JSON only.`;

  const user = `Create a detailed ${tripType} itinerary for "${destination}" for ${duration} in ${language}.
${startCity ? `Starting from: ${startCity}.` : ''}
Budget: ${budget}. Group: ${groupSize} people.

Return JSON:
{
  "title": "itinerary title",
  "summary": "3-sentence trip summary with highlights",
  "days": [
    {
      "day": 1,
      "title": "day title",
      "morning": "detailed morning plan with specific places, timings, and activities",
      "afternoon": "detailed afternoon plan",
      "evening": "detailed evening plan with dinner recommendation",
      "accommodation": "specific hotel/stay recommendation with area",
      "transport": "how to get around this day",
      "estimatedCost": "estimated cost for the day per person"
    }
  ],
  "packingList": ["essential item 1", "item 2", "item 3", "item 4", "item 5", "item 6", "item 7", "item 8"],
  "importantContacts": ["local emergency number", "tourist helpline if applicable"],
  "totalBudget": "total estimated budget for ${groupSize} people for ${duration}",
  "bookingTips": ["advance booking tip", "best booking platform", "discount tip"]
}
Generate one detailed day object per day. Be specific with timings, places, and costs.`;

  try {
    const raw = await callGroq(system, user, 2500);
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
