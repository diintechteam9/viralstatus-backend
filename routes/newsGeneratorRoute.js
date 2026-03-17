const express = require('express');
const router = express.Router();
const axios = require('axios');

const extractFirstJsonObject = (text) => {
  const s = String(text || '').trim();
  if (!s) return null;
  // Fast path
  try {
    return JSON.parse(s);
  } catch (_) {
    // continue
  }
  // Try to extract first {...} block
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) {
      const candidate = s.slice(start, i + 1);
      try {
        return JSON.parse(candidate);
      } catch (_) {
        return null;
      }
    }
  }
  return null;
};

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

  if (!process.env.GROQ_API_KEY || !String(process.env.GROQ_API_KEY).trim()) {
    return res.status(500).json({ error: 'GROQ_API_KEY is missing on the backend. Add it to .env and restart the server.' });
  }

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
    const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
    const headers = {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    };

    const basePayload = {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 900,
      temperature: 0.4
    };

    let rawContent = null;
    let parsed = null;

    // Attempt 1: strict JSON mode (best when it works)
    try {
      const r1 = await axios.post(
        groqUrl,
        { ...basePayload, response_format: { type: 'json_object' } },
        { headers, timeout: 30000 }
      );
      rawContent = r1.data?.choices?.[0]?.message?.content || '';
      parsed = extractFirstJsonObject(rawContent);
    } catch (e1) {
      const msg = e1.response?.data?.error?.message || e1.message;
      const isJsonFormatFailure =
        String(msg || '').toLowerCase().includes('failed to generate json') ||
        String(msg || '').toLowerCase().includes('failed_generation');

      // Attempt 2: non-strict mode + JSON extraction (handles Groq JSON-mode failures)
      if (isJsonFormatFailure) {
        const system2 =
          `${systemPrompt}\n` +
          `You MUST output valid JSON only. Do NOT include markdown or extra text.`;
        const user2 =
          `${userPrompt}\n\n` +
          `IMPORTANT: Output must be a single JSON object.`;

        const r2 = await axios.post(
          groqUrl,
          {
            ...basePayload,
            messages: [
              { role: 'system', content: system2 },
              { role: 'user', content: user2 }
            ],
            temperature: 0.2
            // no response_format here on purpose
          },
          { headers, timeout: 30000 }
        );
        rawContent = r2.data?.choices?.[0]?.message?.content || '';
        parsed = extractFirstJsonObject(rawContent);
      } else {
        throw e1;
      }
    }

    // Attempt 3: ultra-strict retry (works around occasional non-JSON completions)
    if (!parsed) {
      const system3 =
        `${systemPrompt}\n` +
        `Output MUST be a SINGLE valid JSON object and nothing else.\n` +
        `Do not wrap in markdown. Do not add comments. Do not add trailing commas.\n` +
        `All newlines must be inside JSON string values only.`;
      const user3 =
        `Return ONLY a JSON object with keys headline, subheadline, body.\n` +
        `Topic: ${topic.trim()}\n` +
        `Category: ${safeCategory}\n` +
        `Tone: ${safeTone}\n` +
        `Language: ${safeLanguage}\n` +
        `body must have 3 paragraphs separated by \\n\\n.\n` +
        `No extra keys. No extra text.`;

      const r3 = await axios.post(
        groqUrl,
        {
          ...basePayload,
          messages: [
            { role: 'system', content: system3 },
            { role: 'user', content: user3 }
          ],
          temperature: 0,
          max_tokens: 700
        },
        { headers, timeout: 30000 }
      );
      rawContent = r3.data?.choices?.[0]?.message?.content || '';
      parsed = extractFirstJsonObject(rawContent);
    }

    // Final fallback: deterministic template so industrial flow never 500s
    if (!parsed) {
      const t = topic.trim();
      const headline = `${t}`.split(/\s+/).slice(0, 12).join(' ');
      const subheadline = `Update in ${safeCategory}: key developments and what it means next.`;
      const body =
        `In a ${safeTone.toLowerCase()} update, the latest developments around "${t}" are drawing attention across ${safeCategory.toLowerCase()} circles.\n\n` +
        `Early signals suggest a mix of opportunities and open questions, with stakeholders watching for verified details and official statements. Analysts note that context, timelines, and reliable sources will be crucial for understanding the full impact.\n\n` +
        `Going forward, the focus will remain on confirmation of facts, practical implications for the public and industry, and the next milestones expected in the coming days.`;

      const fullArticle = `${headline}\n\n${subheadline}\n\n${body}`;
      return res.json({
        success: true,
        headline,
        subheadline,
        body,
        fullArticle,
        language: safeLanguage,
        category: safeCategory,
        tone: safeTone,
        fallback: true,
        fallbackReason: 'Groq returned non-JSON output; served deterministic template'
      });
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
