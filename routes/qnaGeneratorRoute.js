const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authMiddleware: auth } = require('../middleware/authmiddleware');

const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent`;

const MAX_TOPIC_LEN   = 300;
const MAX_CONTEXT_LEN = 3000;

function sanitizeText(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

async function callGemini(key, prompt, temperature = 0.7, maxTokens = 4096) {
  const res = await axios.post(
    `${GEMINI_ENDPOINT}?key=${key}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    },
    { timeout: 60000 }
  );
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

router.use(auth);

// POST /api/qna/generate
router.post('/generate', async (req, res) => {
  const topic      = sanitizeText(req.body.topic, MAX_TOPIC_LEN);
  const context    = sanitizeText(req.body.context || '', MAX_CONTEXT_LEN);
  const format     = sanitizeText(req.body.format || 'FAQ', 50);
  const difficulty = sanitizeText(req.body.difficulty || 'Medium', 20);
  const language   = sanitizeText(req.body.language || 'English', 50);
  const count      = Math.min(Math.max(parseInt(req.body.count) || 10, 1), 20);

  if (!topic) {
    return res.status(400).json({ success: false, error: 'Topic is required' });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(500).json({ success: false, error: 'GEMINI_API_KEY not configured on server' });
  }

  const contextSection = context ? `\nAdditional Context:\n${context}` : '';

  const prompt = `You are an expert educator and content creator. Generate exactly ${count} ${format}-style question and answer pairs about the topic: "${topic}".

Format: ${format}
Difficulty: ${difficulty}
Language: ${language}${contextSection}

RULES:
- Generate exactly ${count} Q&A pairs
- Questions must be ${difficulty.toLowerCase()} difficulty
- Answers must be clear, accurate, and detailed (2-4 sentences)
- Write everything in ${language}
- Return ONLY a valid JSON array, no explanation, no markdown

Return ONLY this JSON format:
[
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." }
]`;

  try {
    const raw = await callGemini(geminiKey, prompt, 0.7, 4096);

    // Extract JSON array from response
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Invalid response format from AI');

    const qnas = JSON.parse(match[0]);
    if (!Array.isArray(qnas)) throw new Error('AI did not return an array');

    // Validate and sanitize each item
    const cleaned = qnas
      .filter(item => item && typeof item.question === 'string' && typeof item.answer === 'string')
      .map(item => ({
        question: item.question.trim(),
        answer: item.answer.trim(),
      }));

    return res.json({ success: true, qnas: cleaned });
  } catch (e) {
    console.error('[QnaGenerator] generate error:', e.message);
    return res.status(500).json({ success: false, error: e.response?.data?.error?.message || e.message });
  }
});

module.exports = router;
