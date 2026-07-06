const UGCPrompter = require('../models/UGCPrompter');
const Groq = require('groq-sdk');

// ── Groq client (lazy-init so missing key doesn't crash on import) ───────────
let _groq = null;
function getGroq() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

// ── GET all prompts for a client ─────────────────────────────────────────────
exports.getPrompts = async (req, res) => {
  try {
    const clientId = String(req.user.clientId || req.user.id);
    const { campaignId, status, category } = req.query;

    const filter = { clientId };
    if (campaignId) filter.campaignId = campaignId;
    if (status)     filter.status     = status;
    if (category)   filter.category   = category;

    const prompts = await UGCPrompter.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, prompts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET single prompt ────────────────────────────────────────────────────────
exports.getPromptById = async (req, res) => {
  try {
    const prompt = await UGCPrompter.findById(req.params.id).lean();
    if (!prompt) return res.status(404).json({ success: false, message: 'Prompt not found' });
    res.json({ success: true, prompt });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST create prompt ───────────────────────────────────────────────────────
exports.createPrompt = async (req, res) => {
  try {
    const {
      campaignId, title, category, platform, tone,
      duration, brandName, productName, keyPoints, prompt,
      script, hashtags, status, isAiGenerated,
    } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: 'title is required' });
    }

    const clientId = String(req.user.clientId || req.user.id);

    const doc = await UGCPrompter.create({
      clientId, campaignId: campaignId || '',
      title, category, platform, tone,
      duration: Number(duration) || 30,
      brandName: brandName || '', productName: productName || '',
      keyPoints: Array.isArray(keyPoints) ? keyPoints : [],
      prompt: prompt || script || '',
      script: script || '',
      hashtags: Array.isArray(hashtags) ? hashtags : [],
      status: status || 'active',
      isAiGenerated: !!isAiGenerated,
    });

    res.status(201).json({ success: true, prompt: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH update prompt ──────────────────────────────────────────────────────
exports.updatePrompt = async (req, res) => {
  try {
    const allowed = [
      'title', 'category', 'platform', 'tone', 'duration',
      'brandName', 'productName', 'keyPoints', 'prompt',
      'script', 'hashtags', 'status', 'campaignId',
    ];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.duration) update.duration = Number(update.duration);

    const doc = await UGCPrompter.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Prompt not found' });
    res.json({ success: true, prompt: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE prompt ────────────────────────────────────────────────────────────
exports.deletePrompt = async (req, res) => {
  try {
    const doc = await UGCPrompter.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Prompt not found' });
    res.json({ success: true, message: 'Prompt deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST AI generate prompt + script via Groq ────────────────────────────────
exports.generatePrompt = async (req, res) => {
  try {
    const {
      topic = '',
      script = '', category = 'testimonial',
      tone = 'casual', platform = 'instagram', duration = 30,
      keyPoints = [],
    } = req.body;

    const brand   = topic || 'our brand';
    const product = topic || 'our product';
    const kp      = Array.isArray(keyPoints) && keyPoints.length
      ? keyPoints.filter(p => p.trim()).map((p, i) => `${i + 1}. ${p}`).join('\n')
      : '';

    const platformLabel =
      platform === 'both' ? 'Instagram Reels and YouTube Shorts'
      : platform === 'youtube' ? 'YouTube Shorts'
      : 'Instagram Reels';

    const aiPrompt = `You are an expert UGC (User Generated Content) script writer for social media.

Generate a complete UGC content package. Respond with ONLY a raw JSON object — no markdown fences, no backticks, no explanation before or after. Start your response with { and end with }.

Input details:
- Topic/Product: ${product}
- Brand: ${brand}
- Platform: ${platformLabel}
- Content Type: ${category}
- Tone: ${tone}
- Video Duration: ${duration} seconds
${kp ? `- Key Points to Cover:\n${kp}` : ''}

Required JSON structure (all values must be plain readable strings, NOT nested JSON):
{
  "title": "A short catchy title for this UGC content (plain text, max 10 words)",
  "instructions": "Creator filming instructions as plain text with bullet points using • symbol. Example: • Film in natural light near a window\\n• Hold product clearly in frame\\n• Speak directly to camera with energy\\n• Show product in use\\n• End with a smile and CTA",
  "script": "Full word-for-word script the creator reads aloud. Use this format:\\n\\n[HOOK]\\nOpening line to grab attention in first 3 seconds.\\n\\n[MAIN CONTENT]\\nCore message about the product, 2-3 key benefits, personal experience.\\n\\n[CTA]\\nClear call to action — follow, link in bio, comment, etc.",
  "prompt": "One or two sentence creative direction summary for this video.",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5", "hashtag6"]
}

RULES:
- Every value must be a plain string. No nested objects. No arrays except hashtags.
- instructions must use \\n between bullet points
- script must have [HOOK], [MAIN CONTENT], [CTA] sections separated by \\n\\n
- hashtags must have NO # symbol, just the word
- Do NOT wrap response in markdown code blocks
- Start response with { immediately`;

    const groq = getGroq();
    const chat = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: aiPrompt }],
      temperature: 0.75,
      max_tokens: 1800,
    });

    const rawText = (chat.choices?.[0]?.message?.content || '').trim();

    // ── Robust JSON extraction ───────────────────────────────────────────
    let parsed = null;
    try {
      // Strip markdown code fences if model still adds them
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('[UGCPrompter] JSON parse failed:', e.message);
      parsed = null;
    }

    // ── Sanitize: if any value is itself a JSON string, unwrap it ────────
    if (parsed) {
      for (const key of ['title', 'instructions', 'script', 'prompt']) {
        if (typeof parsed[key] === 'string') {
          // If AI returned escaped JSON inside a string, try to unwrap
          const v = parsed[key].trim();
          if ((v.startsWith('{') || v.startsWith('[')) ) {
            try { parsed[key] = JSON.stringify(JSON.parse(v)); } catch { /* keep as-is */ }
          }
          // Unescape literal \n sequences into real newlines
          parsed[key] = parsed[key].replace(/\\n/g, '\n');
        }
      }
    }

    // ── Fallback if JSON parsing still fails ────────────────────────────
    if (!parsed) {
      parsed = {
        title: `${product} UGC — ${category.charAt(0).toUpperCase() + category.slice(1)} (${duration}s)`,
        instructions: `• Film in natural light near a window\n• Hold product clearly in frame\n• Speak directly to camera with ${tone} energy\n• Show the product in action\n• End with a clear call to action`,
        script: `[HOOK]\nHey everyone! I have to tell you about ${product} — this one genuinely surprised me.\n\n[MAIN CONTENT]\n${kp || `I've been using it for a while now and honestly the results speak for themselves. It's one of those things you don't know you need until you try it.`}\n\n[CTA]\nIf you want to try it yourself, check the link in bio! Drop a comment if you have questions — I reply to everyone! 🙌`,
        prompt: `A ${tone} ${category} video about ${product} for ${platformLabel}.`,
        hashtags: [
          brand.toLowerCase().replace(/\s+/g, ''),
          product.toLowerCase().replace(/\s+/g, ''),
          category, 'ugc', 'ugccreator',
          platform === 'youtube' ? 'youtuber' : 'instagramreels',
        ].filter(Boolean),
      };
    }

    // Ensure hashtags is array
    if (!Array.isArray(parsed.hashtags)) {
      parsed.hashtags = [brand.toLowerCase().replace(/\s+/g, ''), 'ugc', 'ugccreator'];
    }

    res.json({
      success: true,
      generated: {
        title:        parsed.title || `${brand} — ${category} (${duration}s)`,
        instructions: parsed.instructions || '',
        script:       parsed.script || '',
        prompt:       parsed.prompt || parsed.instructions || '',
        hashtags:     parsed.hashtags,
        category,
        platform,
        tone,
        duration,
        isAiGenerated: true,
      },
    });
  } catch (err) {
    console.error('[UGCPrompter] generatePrompt error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
