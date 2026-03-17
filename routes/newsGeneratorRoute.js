const express = require('express');
const router = express.Router();
const axios = require('axios');

/**
 * POST /api/news/generate-news
 * Generates a structured news article using Groq LLM.
 * Returns: { headline, subheadline, body, fullArticle }
 */
router.post('/generate-news', async (req, res) => {
  const { topic, category, tone, language } = req.body;

  if (!topic || !topic.trim()) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  const safeCategory = category || 'General';
  const safeTone = tone || 'Formal';
  const safeLanguage = language || 'English';

  const systemPrompt = `You are a professional news journalist. Always respond in ${safeLanguage}. Write structured, factual, and engaging news articles.`;

  const userPrompt = `Write a ${safeTone.toLowerCase()} news article in ${safeLanguage} about: "${topic.trim()}".
Category: ${safeCategory}

Return STRICT JSON only with this exact structure:
{
  "headline": "Main headline here",
  "subheadline": "Supporting subheadline here",
  "body": "Full article body with 3-4 paragraphs separated by newlines. Each paragraph should be 2-3 sentences."
}

Rules:
- headline: short, punchy, max 12 words
- subheadline: supporting context, max 20 words  
- body: 3-4 paragraphs, journalistic tone, factual style
- All text must be in ${safeLanguage}
- Return JSON only, no extra text`;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 1024,
        temperature: 0.7,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const rawContent = response.data?.choices?.[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response as JSON' });
    }

    const headline = (parsed.headline || '').trim();
    const subheadline = (parsed.subheadline || '').trim();
    const body = (parsed.body || '').trim();

    if (!headline || !body) {
      return res.status(500).json({ error: 'Incomplete article generated. Please try again.' });
    }

    const fullArticle = `${headline}\n\n${subheadline}\n\n${body}`;

    return res.json({
      success: true,
      headline,
      subheadline,
      body,
      fullArticle,
      language: safeLanguage,
      category: safeCategory,
      tone: safeTone
    });

  } catch (err) {
    const status = err.response?.status;
    const groqError = err.response?.data?.error?.message;

    console.error('[NewsGenerator] Groq API error:', groqError || err.message);

    if (status === 401) {
      return res.status(500).json({ error: 'Invalid Groq API key. Check server configuration.' });
    }
    if (status === 429) {
      return res.status(429).json({ error: 'Rate limit reached. Please wait a moment and try again.' });
    }
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'Request timed out. Please try again.' });
    }

    return res.status(500).json({ error: groqError || 'Failed to generate news article. Please try again.' });
  }
});

module.exports = router;
