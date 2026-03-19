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

const callGroq = async (system, user, maxTokens = 2000) => {
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

// POST /api/carousel/generate
router.post('/generate', async (req, res) => {
  const { topic, style = 'Educational', slideCount = 7, language = 'English', platform = 'Instagram' } = req.body;
  if (!topic?.trim()) return res.status(400).json({ success: false, error: 'Topic is required' });

  const count = Math.min(Math.max(Number(slideCount) || 7, 3), 10);
  const system = `You are a professional social media content strategist specializing in ${platform} carousel posts. You know exactly how to structure content for maximum saves and shares. Always respond in ${language}. Return valid JSON only.`;

  const user = `Create a ${style} carousel post for ${platform} in ${language} about: "${topic}".
Generate exactly ${count} slides.

Return JSON:
{
  "slides": [
    {
      "tag": "optional label like 'INTRO', 'TIP 1', 'STEP 1', 'KEY POINT', 'CONCLUSION' etc.",
      "heading": "bold, punchy slide headline (max 8 words)",
      "body": "slide body content (2-4 sentences, actionable and specific)",
      "cta": "optional mini CTA for last slide only like 'Save this post!' or 'Follow for more!'"
    }
  ]
}

Structure rules:
- Slide 1: Hook/Cover — make people want to swipe
- Slides 2 to ${count - 1}: Core content — each slide = one clear idea
- Slide ${count}: Conclusion/CTA — summarize + call to action
- Each slide must be self-contained and valuable
- Use ${style} tone throughout
- Generate exactly ${count} slides`;

  try {
    const raw = await callGroq(system, user, 2000);
    const parsed = extractJson(raw);
    if (!parsed?.slides) return res.status(500).json({ success: false, error: 'Failed to parse response. Please try again.' });
    return res.json({ success: true, slides: parsed.slides });
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) return res.status(429).json({ success: false, error: 'Rate limit reached. Please wait a moment.' });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
