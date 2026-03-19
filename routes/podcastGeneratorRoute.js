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

// POST /api/podcast/generate-script
router.post('/generate-script', async (req, res) => {
  const { topic, format = 'Solo Monologue', duration = '5 min', language = 'English' } = req.body;
  if (!topic?.trim()) return res.status(400).json({ success: false, error: 'Topic is required' });

  const wordCount = duration === '2 min' ? 300 : duration === '5 min' ? 700 : duration === '10 min' ? 1400 : 2000;
  const system = `You are a professional podcast scriptwriter and voice-over artist with experience in ${format} format content. You write scripts that sound natural when spoken aloud. Always respond in ${language}. Return valid JSON only.`;

  const user = `Write a complete ${format} podcast/voice-over script in ${language} about: "${topic}".
Target duration: ${duration} (~${wordCount} words).

Return JSON:
{
  "title": "episode/content title",
  "description": "2-sentence episode description for show notes",
  "intro": "warm, engaging opening (30-45 seconds when read aloud)",
  "segments": [
    {
      "segmentTitle": "segment name",
      "content": "full spoken content for this segment"
    }
  ],
  "outro": "closing with CTA — subscribe, follow, share (20-30 seconds)",
  "showNotes": "bullet points of key topics covered",
  "estimatedDuration": "${duration}"
}

Make it conversational, natural, and engaging. Use [PAUSE] markers where natural pauses should occur. Use [EMPHASIS] for words to stress.`;

  try {
    const raw = await callGroq(system, user, 2000);
    const parsed = extractJson(raw);
    if (!parsed?.segments) return res.status(500).json({ success: false, error: 'Failed to parse response. Please try again.' });
    return res.json({ success: true, ...parsed });
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) return res.status(429).json({ success: false, error: 'Rate limit reached. Please wait a moment.' });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
