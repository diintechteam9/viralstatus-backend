const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const SocialMention = require('../models/SocialMention');
const {
  PLATFORM_LABELS,
  getProviderStatus,
  searchKeyword,
  fetchTrends,
  buildSentimentContext,
} = require('../services/socialSensingService');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

const callGroq = async (system, user, maxTokens = 1200, temperature = 0.65) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing — content generation unavailable');
  const r = await axios.post(GROQ_URL, {
    model: MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: maxTokens,
    temperature,
  }, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
  return (r.data?.choices?.[0]?.message?.content || '').trim();
};

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

const normalizeSentiment = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return null;
  let positive = Number(parsed.positive);
  let neutral = Number(parsed.neutral);
  let negative = Number(parsed.negative);
  if ([positive, neutral, negative].some((n) => Number.isNaN(n))) return null;
  const sum = positive + neutral + negative;
  if (sum <= 0) return null;
  if (Math.abs(sum - 100) > 1) {
    positive = Math.round((positive / sum) * 100);
    neutral = Math.round((neutral / sum) * 100);
    negative = Math.max(0, 100 - positive - neutral);
  }
  return {
    positive,
    neutral,
    negative,
    summary: String(parsed.summary || parsed.overall || '').trim(),
  };
};

const getClientId = (req) => {
  if (req.client?.id) return String(req.client.id);
  try {
    const raw = req.headers['x-client-id'];
    if (raw) return String(JSON.parse(raw));
  } catch (_) {}
  return 'anonymous';
};

const PLATFORM_ALIASES = {
  twitter: ['twitter', 'x'],
  x: ['twitter', 'x'],
  instagram: ['instagram'],
  facebook: ['facebook'],
  youtube: ['youtube'],
  linkedin: ['linkedin'],
  reddit: ['reddit'],
  telegram: ['telegram'],
  news: ['news'],
  blog: ['blog'],
};

/** Remove markdown symbols AI often adds: ** # headers, multi-platform dumps */
const sanitizeGeneratedContent = (raw, platform) => {
  if (!raw) return '';
  let text = String(raw).trim();

  text = text.replace(/\*\*/g, '').replace(/__/g, '');
  text = text.replace(/^\s*#{1,6}\s+/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');

  const headerNames = 'Facebook|Twitter|X|LinkedIn|Instagram|YouTube|TikTok|Reddit|Telegram|News|Blog';
  const headerRe = new RegExp(`(?:^|\\n)\\s*(${headerNames})\\s*:?\\s*`, 'gi');
  const matches = [...text.matchAll(headerRe)];

  if (matches.length > 1) {
    const want = (PLATFORM_ALIASES[platform] || [platform.toLowerCase()]);
    let picked = null;
    for (let i = 0; i < matches.length; i++) {
      const name = matches[i][1].toLowerCase();
      const bodyStart = matches[i].index + matches[i][0].length;
      const bodyEnd = matches[i + 1] ? matches[i + 1].index : text.length;
      const body = text.slice(bodyStart, bodyEnd).trim();
      if (want.some((w) => name.includes(w) || w.includes(name))) {
        picked = body;
        break;
      }
    }
    text = picked || text.slice(matches[0].index + matches[0][0].length, matches[1]?.index || text.length).trim();
  }

  text = text.replace(new RegExp(`^\\s*(${headerNames})\\s*:?\\s*`, 'i'), '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
};

const buildContentPrompt = (contentType, platform, brand, keyword, tone) => {
  const platformName = PLATFORM_LABELS[platform] || platform;
  return `Write ONE ${contentType} for ${platformName} ONLY.

Brand: ${brand}
Keyword: ${keyword}
Tone: ${tone}

STRICT RULES:
- Output content for ${platformName} only. Do NOT write for Facebook, Twitter, Instagram, LinkedIn, YouTube, or any other platform.
- Plain text only. NO markdown: no **, no ##, no bullet lists with * or +.
- Do NOT add labels like "Facebook:" or "**Instagram**" at the start.
- Do NOT use the + symbol.
- Hashtags are allowed at the end (example: #Brand #Keyword) — that is normal.
- Return only the post/caption text, ready to copy-paste. No explanations.`;
};

const CONTENT_SYSTEM = `You are a social media copywriter. You write exactly one platform-specific post in plain text. Never use markdown. Never output multiple platforms in one response.`;

// GET /api/social-sensing/status — which real-data providers are configured
router.get('/status', (req, res) => {
  res.json({ success: true, providers: getProviderStatus() });
});

// GET /api/social-sensing/search — real data only
router.get('/search', async (req, res) => {
  const keyword = (req.query.keyword || '').trim();
  const platform = (req.query.platform || 'news').trim();
  if (!keyword) {
    return res.status(400).json({ success: false, error: 'Keyword is required' });
  }

  try {
    const { results, source, warnings } = await searchKeyword(keyword, platform);
    if (!results?.topPosts?.length) {
      return res.status(404).json({
        success: false,
        error: `No results found for "${keyword}" on ${PLATFORM_LABELS[platform] || platform}.`,
        warnings,
      });
    }
    res.json({ success: true, results, source, warnings: warnings || [] });
  } catch (e) {
    const status = e.response?.status === 429 ? 429 : 502;
    res.status(status).json({
      success: false,
      error: e.message,
      hint: 'Verify API keys in server .env (SERPAPI_KEY, NEWS_API_KEY, TWITTER_BEARER_TOKEN, etc.)',
    });
  }
});

// POST /api/social-sensing/generate
router.post('/generate', async (req, res) => {
  const { contentType = 'Post', platform = 'instagram', brand = '', keyword = '', tone = 'Professional' } = req.body;
  if (!brand?.trim()) return res.status(400).json({ success: false, error: 'Brand is required' });
  if (!keyword?.trim()) return res.status(400).json({ success: false, error: 'Keyword is required' });

  try {
    const raw = await callGroq(
      CONTENT_SYSTEM,
      buildContentPrompt(contentType, platform, brand.trim(), keyword.trim(), tone),
      800
    );
    const content = sanitizeGeneratedContent(raw, platform);
    if (!content) return res.status(500).json({ success: false, error: 'Empty response from AI' });
    res.json({ success: true, content });
  } catch (e) {
    if (e.response?.status === 429) {
      return res.status(429).json({ success: false, error: 'AI rate limit. Please wait and retry.' });
    }
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/social-sensing/generate-mentions
router.post('/generate-mentions', async (req, res) => {
  const { brand, keyword, tone = 'Professional', contentTypes = [], platforms = [], dailyVolume = 10, duration = 1 } = req.body;
  if (!brand?.trim()) return res.status(400).json({ success: false, error: 'Brand is required' });
  if (!keyword?.trim()) return res.status(400).json({ success: false, error: 'Keyword is required' });
  if (!contentTypes.length) return res.status(400).json({ success: false, error: 'Select at least 1 content type' });
  if (!platforms.length) return res.status(400).json({ success: false, error: 'Select at least 1 platform' });
  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ success: false, error: 'GROQ_API_KEY missing — bulk generation unavailable' });
  }

  const clientId = getClientId(req);
  const jobId = crypto.randomBytes(8).toString('hex');
  const totalCount = Math.min(Math.max(Number(dailyVolume) || 1, 1) * Math.max(Number(duration) || 1, 1), 500);

  const tasks = [];
  for (let i = 0; i < totalCount; i++) {
    tasks.push({
      clientId,
      jobId,
      brand: brand.trim(),
      keyword: keyword.trim(),
      tone,
      platform: platforms[i % platforms.length],
      contentType: contentTypes[i % contentTypes.length],
      status: 'pending',
    });
  }

  try {
    const inserted = await SocialMention.insertMany(tasks, { ordered: false });
    generateInBackground(inserted).catch((err) => console.error('[social-sensing] bulk:', err.message));
    res.json({
      success: true,
      jobId,
      total: totalCount,
      message: `Generating ${totalCount} mentions in background...`,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

async function generateInBackground(docs) {
  const BATCH = 5;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    await Promise.all(batch.map(async (doc) => {
      try {
        const raw = await callGroq(
          CONTENT_SYSTEM,
          buildContentPrompt(doc.contentType, doc.platform, doc.brand, doc.keyword, doc.tone),
          500
        );
        const content = sanitizeGeneratedContent(raw, doc.platform);
        if (!content) throw new Error('AI returned empty content');
        await SocialMention.findByIdAndUpdate(doc._id, { generatedText: content, status: 'ready' });
      } catch (err) {
        await SocialMention.findByIdAndUpdate(doc._id, { status: 'failed', errorMsg: err.message });
      }
    }));
    await new Promise((r) => setTimeout(r, 500));
  }
}

// GET /api/social-sensing/mentions
router.get('/mentions', async (req, res) => {
  const { jobId } = req.query;
  if (!jobId) return res.status(400).json({ success: false, error: 'jobId is required' });
  try {
    const mentions = await SocialMention.find({ jobId }).sort({ createdAt: 1 }).lean();
    const total = mentions.length;
    const ready = mentions.filter((m) => m.status === 'ready').length;
    const failed = mentions.filter((m) => m.status === 'failed').length;
    const pending = mentions.filter((m) => m.status === 'pending').length;
    res.json({ success: true, mentions, stats: { total, ready, failed, pending } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/social-sensing/publish
router.post('/publish', async (req, res) => {
  const { mentionId, scheduledAt } = req.body;
  if (!mentionId) return res.status(400).json({ success: false, error: 'mentionId is required' });
  try {
    const update = scheduledAt
      ? { status: 'scheduled', scheduledAt: new Date(scheduledAt) }
      : { status: 'published', publishedAt: new Date() };
    const mention = await SocialMention.findByIdAndUpdate(mentionId, update, { new: true });
    if (!mention) return res.status(404).json({ success: false, error: 'Mention not found' });
    res.json({ success: true, mention });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/social-sensing/trends — real data only
router.get('/trends', async (req, res) => {
  const geo = (req.query.geo || 'IN').toUpperCase();
  try {
    const { trends, source } = await fetchTrends(geo);
    if (!trends?.length) {
      return res.status(404).json({ success: false, error: 'No trending topics returned from live sources.' });
    }
    res.json({ success: true, trends, source });
  } catch (e) {
    res.status(502).json({
      success: false,
      error: e.message,
      hint: 'Configure SERPAPI_KEY and/or NEWS_API_KEY in server .env',
    });
  }
});

// GET /api/social-sensing/sentiment — real context + AI analysis
router.get('/sentiment', async (req, res) => {
  const keyword = (req.query.keyword || '').trim();
  if (!keyword) return res.status(400).json({ success: false, error: 'Keyword is required' });
  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ success: false, error: 'GROQ_API_KEY missing — sentiment analysis unavailable' });
  }

  try {
    const { contextText, errors } = await buildSentimentContext(keyword);
    if (!contextText?.trim()) {
      return res.status(502).json({
        success: false,
        error: `Could not fetch real data to analyze sentiment for "${keyword}".`,
        details: errors,
      });
    }

    const raw = await callGroq(
      'You are a sentiment analysis expert. Reply with a single JSON object only, no markdown.',
      `Based on these REAL search/social results about "${keyword}":
"${contextText}"

Analyze overall public sentiment. Return exactly:
{"positive": 65, "neutral": 22, "negative": 13, "summary": "one line summary"}
Use integers 0-100. positive + neutral + negative must equal 100.`,
      500,
      0.3
    );
    const parsed = normalizeSentiment(extractJson(raw));
    if (!parsed) {
      throw new Error('Failed to parse sentiment from AI response. Try again.');
    }
    res.json({ success: true, sentiment: parsed, source: 'real-data+groq' });
  } catch (e) {
    if (e.response?.status === 429) {
      return res.status(429).json({ success: false, error: 'Rate limit. Please wait.' });
    }
    const code = e.code || '';
    const msg = e.message || 'Sentiment analysis failed';
    if (code === 'ECONNABORTED' || /timeout/i.test(msg)) {
      return res.status(504).json({ success: false, error: 'AI analysis timed out. Please retry.' });
    }
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/social-sensing/export
router.get('/export', async (req, res) => {
  const { jobId, format = 'json' } = req.query;
  if (!jobId) return res.status(400).json({ success: false, error: 'jobId is required' });
  try {
    const mentions = await SocialMention.find({ jobId, status: 'ready' }).lean();
    if (!mentions.length) {
      return res.status(404).json({ success: false, error: 'No ready mentions to export for this job' });
    }
    if (format === 'csv') {
      const header = 'Platform,ContentType,Tone,Brand,Keyword,Status,Content\n';
      const rows = mentions.map((m) =>
        `"${m.platform}","${m.contentType}","${m.tone}","${m.brand}","${m.keyword}","${m.status}","${(m.generatedText || '').replace(/"/g, '""')}"`
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="mentions-${jobId}.csv"`);
      return res.send(header + rows);
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="mentions-${jobId}.json"`);
    res.send(JSON.stringify(mentions, null, 2));
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
