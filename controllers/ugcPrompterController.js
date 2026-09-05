const UGCPrompter = require('../models/UGCPrompter');
const Groq = require('groq-sdk');

// ── Groq client initialization with validation ───────────────────────────────
let _groq = null;
function getGroq() {
  if (!_groq) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY environment variable is not set. AI script generation will not work.');
    }
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

// ── Input validation helpers ──────────────────────────────────────────────────
function validatePromptInput(data) {
  const errors = [];
  
  if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
    errors.push('Title is required and must be a non-empty string');
  } else if (data.title.length > 200) {
    errors.push('Title must be 200 characters or less');
  }
  
  if (data.duration) {
    const dur = Number(data.duration);
    if (isNaN(dur) || dur < 5 || dur > 600) {
      errors.push('Duration must be between 5 and 600 seconds');
    }
  }
  
  if (data.script && data.script.length > 5000) {
    errors.push('Script must be 5000 characters or less');
  }
  
  if (data.prompt && data.prompt.length > 2000) {
    errors.push('Prompt must be 2000 characters or less');
  }
  
  if (data.category && !['testimonial', 'demo', 'unboxing', 'tutorial', 'review', 'lifestyle', 'challenge', 'other'].includes(data.category)) {
    errors.push('Invalid category');
  }
  
  if (data.tone && !['casual', 'professional', 'funny', 'emotional', 'energetic'].includes(data.tone)) {
    errors.push('Invalid tone');
  }
  
  if (data.platform && !['instagram', 'youtube', 'both'].includes(data.platform)) {
    errors.push('Invalid platform');
  }
  
  return errors;
}

// ── GET all prompts for a client with pagination ──────────────────────────────
exports.getPrompts = async (req, res) => {
  try {
    const clientId = String(req.user.clientId || req.user.id);
    const { campaignId, status, category, page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const filter = { clientId };
    if (req.user.role === 'mobileuser') {
      filter.$or = [
        { isPrivate: { $ne: true } },
        { creatorId: req.user.id }
      ];
    }
    if (campaignId) filter.campaignId = campaignId;
    if (status) filter.status = status;
    if (category) filter.category = category;

    const [prompts, total] = await Promise.all([
      UGCPrompter.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      UGCPrompter.countDocuments(filter),
    ]);
    
    const cleanedPrompts = prompts.map(p => ({
      _id: p._id,
      id: p._id.toString(),
      title: p.title,
      category: p.category,
      tone: p.tone,
      duration: p.duration,
      script: p.script,
      status: p.status,
      isAiGenerated: p.isAiGenerated,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      prompt: p.prompt,
      platform: p.platform,
      brandName: p.brandName,
      productName: p.productName,
      keyPoints: p.keyPoints,
      type: p.isPrivate ? 'private' : 'public',
    }));
    
    res.json({ 
      success: true, 
      prompts: cleanedPrompts,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
    });
  } catch (err) {
    console.error('[UGCPrompter] getPrompts error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET single prompt ────────────────────────────────────────────────────────
exports.getPromptById = async (req, res) => {
  try {
    const clientId = String(req.user.clientId || req.user.id);
    const prompt = await UGCPrompter.findById(req.params.id).lean();
    
    if (!prompt) return res.status(404).json({ success: false, message: 'Prompt not found' });
    
    // Validate ownership
    if (String(prompt.clientId) !== clientId && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Additional privacy check for creators
    if (req.user.role === 'mobileuser') {
      if (prompt.isPrivate && prompt.creatorId !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Unauthorized. This script is private.' });
      }
    }
    
    res.json({
      success: true,
      prompt: {
        _id: prompt._id,
        title: prompt.title,
        category: prompt.category,
        tone: prompt.tone,
        duration: prompt.duration,
        script: prompt.script,
        status: prompt.status,
        createdAt: prompt.createdAt,
        prompt: prompt.prompt,
        platform: prompt.platform,
        brandName: prompt.brandName,
        productName: prompt.productName,
        keyPoints: prompt.keyPoints,
        type: prompt.isPrivate ? 'private' : 'public',
      }
    });
  } catch (err) {
    console.error('[UGCPrompter] getPromptById error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST create prompt ───────────────────────────────────────────────────────
exports.createPrompt = async (req, res) => {
  try {
    const {
      campaignId, title, category, platform, tone,
      duration, brandName, productName, keyPoints, prompt,
      script, hashtags, status, isAiGenerated, autoApprovalSettings, brollSource,
    } = req.body;

    // Validate input
    const validationErrors = validatePromptInput({ title, duration, script, prompt, category, tone, platform });
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, message: validationErrors.join('; ') });
    }

    const isCreator = req.user.role === 'mobileuser';
    const creatorId = isCreator ? req.user.id : '';
    const isPrivate = isCreator;

    const clientId = String(req.user.clientId || req.user.id);

    const doc = await UGCPrompter.create({
      clientId, campaignId: campaignId || '',
      title: title.trim(), category: category || 'testimonial', platform: platform || 'instagram', tone: tone || 'casual',
      duration: Math.min(600, Math.max(5, Number(duration) || 30)),
      brandName: (brandName || '').trim(), productName: (productName || '').trim(),
      keyPoints: Array.isArray(keyPoints) ? keyPoints.filter(k => k && typeof k === 'string').slice(0, 10) : [],
      prompt: (prompt || script || '').trim(),
      script: (script || '').trim(),
      hashtags: Array.isArray(hashtags) ? hashtags.filter(h => h && typeof h === 'string').slice(0, 20) : [],
      status: status || 'pending',
      isAiGenerated: !!isAiGenerated,
      creatorId,
      isPrivate,
      brollSource: brollSource || 'pexels',
      autoApprovalSettings: autoApprovalSettings || {
        recording: false,
        editingRequest: false,
        finalEditedVideo: false
      }
    });

    res.status(201).json({
      success: true,
      prompt: {
        _id: doc._id,
        clientId: doc.clientId,
        title: doc.title,
        category: doc.category,
        tone: doc.tone,
        duration: doc.duration,
        script: doc.script,
        status: doc.status,
        isAiGenerated: doc.isAiGenerated,
        creatorId: doc.creatorId,
        isPrivate: doc.isPrivate,
        type: doc.isPrivate ? 'private' : 'public',
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      }
    });
  } catch (err) {
    console.error('[UGCPrompter] createPrompt error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH update prompt ──────────────────────────────────────────────────────
exports.updatePrompt = async (req, res) => {
  try {
    const clientId = String(req.user.clientId || req.user.id);
    const doc = await UGCPrompter.findById(req.params.id);
    
    if (!doc) return res.status(404).json({ success: false, message: 'Prompt not found' });
    
    // Validate ownership
    if (String(doc.clientId) !== clientId && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Creators can only edit their own private scripts
    if (req.user.role === 'mobileuser') {
      if (!doc.isPrivate || doc.creatorId !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Unauthorized. You can only edit your own private scripts.' });
      }
    }

    const allowed = [
      'title', 'category', 'platform', 'tone', 'duration',
      'brandName', 'productName', 'keyPoints', 'prompt',
      'script', 'hashtags', 'status', 'campaignId', 'autoApprovalSettings', 'brollSource',
    ];
    
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === 'title') update[key] = String(req.body[key]).trim();
        else if (key === 'duration') update[key] = Math.min(600, Math.max(5, Number(req.body[key]) || 30));
        else if (key === 'script' || key === 'prompt') update[key] = String(req.body[key]).trim().slice(0, 5000);
        else if (key === 'keyPoints') update[key] = Array.isArray(req.body[key]) ? req.body[key].slice(0, 10) : [];
        else if (key === 'hashtags') update[key] = Array.isArray(req.body[key]) ? req.body[key].slice(0, 20) : [];
        else update[key] = req.body[key];
      }
    }

    // Validate update
    const validationErrors = validatePromptInput(update);
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, message: validationErrors.join('; ') });
    }

    const updated = await UGCPrompter.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ success: true, prompt: updated });
  } catch (err) {
    console.error('[UGCPrompter] updatePrompt error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE prompt ────────────────────────────────────────────────────────────
exports.deletePrompt = async (req, res) => {
  try {
    const clientId = String(req.user.clientId || req.user.id);
    const doc = await UGCPrompter.findById(req.params.id);
    
    if (!doc) return res.status(404).json({ success: false, message: 'Prompt not found' });
    
    // Validate ownership
    if (String(doc.clientId) !== clientId && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Creators can only delete their own private scripts
    if (req.user.role === 'mobileuser') {
      if (!doc.isPrivate || doc.creatorId !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Unauthorized. You can only delete your own private scripts.' });
      }
    }

    await UGCPrompter.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Prompt deleted' });
  } catch (err) {
    console.error('[UGCPrompter] deletePrompt error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST AI generate prompt + script via Groq ────────────────────────────────
exports.generatePrompt = async (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ 
        success: false, 
        message: 'AI script generation is not configured. GROQ_API_KEY is missing.' 
      });
    }

    const {
      topic = '',
      script = '', category = 'testimonial',
      tone = 'casual', platform = 'instagram', duration = 30,
      keyPoints = [],
    } = req.body;

    // Validate input
    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Topic is required' });
    }

    const brand = topic.trim().slice(0, 100);
    const product = topic.trim().slice(0, 100);
    const kp = Array.isArray(keyPoints) && keyPoints.length
      ? keyPoints.filter(p => p && typeof p === 'string').slice(0, 5).map((p, i) => `${i + 1}. ${p}`).join('\n')
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
    
    let chat;
    try {
      chat = await Promise.race([
        groq.chat.completions.create({
          model: 'llama-3.1-70b-versatile',
          messages: [{ role: 'user', content: aiPrompt }],
          temperature: 0.75,
          max_tokens: 1800,
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Groq API timeout after 30 seconds')), 30000)
        )
      ]);
    } catch (err) {
      if (err.message.includes('timeout')) {
        return res.status(504).json({ success: false, message: 'AI service timeout. Please try again.' });
      }
      throw err;
    }

    const rawText = (chat.choices?.[0]?.message?.content || '').trim();

    // ── Robust JSON extraction ───────────────────────────────────────────
    let parsed = null;
    try {
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

    // ── Sanitize parsed data ──────────────────────────────────────────────
    if (parsed) {
      for (const key of ['title', 'instructions', 'script', 'prompt']) {
        if (typeof parsed[key] === 'string') {
          const v = parsed[key].trim();
          if ((v.startsWith('{') || v.startsWith('[')) ) {
            try { parsed[key] = JSON.stringify(JSON.parse(v)); } catch { /* keep as-is */ }
          }
          parsed[key] = parsed[key].replace(/\\n/g, '\n');
        }
      }
    }

    // ── Validate required fields ──────────────────────────────────────────
    if (!parsed || !parsed.title || !parsed.script || !parsed.instructions) {
      console.error('[UGCPrompter] AI response missing required fields');
      return res.status(400).json({ success: false, message: 'AI generation failed. Please try again.' });
    }

    // Ensure hashtags is array
    if (!Array.isArray(parsed.hashtags)) {
      parsed.hashtags = [brand.toLowerCase().replace(/\s+/g, ''), 'ugc', 'ugccreator'];
    }

    const generatedData = {
      title: parsed.title.slice(0, 200),
      instructions: parsed.instructions.slice(0, 2000),
      script: parsed.script.slice(0, 5000),
      category,
      tone,
      duration: Math.min(600, Math.max(5, Number(duration) || 30)),
      isAiGenerated: true,
    };

    const isCreator = req.user.role === 'mobileuser';
    const creatorId = isCreator ? req.user.id : '';
    const isPrivate = isCreator;

    // Auto-save to database
    const clientId = String(req.user.clientId || req.user.id);
    const savedPrompt = await UGCPrompter.create({
      clientId,
      campaignId: '',
      title: generatedData.title,
      category: generatedData.category,
      platform: platform || 'instagram',
      tone: generatedData.tone,
      duration: generatedData.duration,
      brandName: brand,
      productName: product,
      keyPoints: Array.isArray(keyPoints) ? keyPoints.slice(0, 10) : [],
      prompt: parsed.instructions || parsed.prompt || '',
      script: generatedData.script,
      hashtags: parsed.hashtags.slice(0, 20) || [],
      status: 'pending',
      isAiGenerated: true,
      creatorId,
      isPrivate,
    });

    res.json({
      success: true,
      generated: generatedData,
      saved: {
        _id: savedPrompt._id,
        title: savedPrompt.title,
        creatorId: savedPrompt.creatorId,
        isPrivate: savedPrompt.isPrivate,
        type: savedPrompt.isPrivate ? 'private' : 'public',
      },
    });
  } catch (err) {
    console.error('[UGCPrompter] generatePrompt error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
