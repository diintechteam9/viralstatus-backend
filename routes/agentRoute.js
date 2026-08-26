const express = require('express');
const router = express.Router();
const axios = require('axios');
const AgentHistory = require('../models/AgentHistory');
const { protect } = require('../middleware/auth');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-70b-versatile';

const AGENT_PROMPTS = {
  yovo: {
    system: `You are Yovo — the Master AI Brand Strategist and Multi-Agent Orchestrator built by YovoAI.

Your role is to think at the highest level. When a user gives you a goal, you:
1. Deeply analyze the brand, audience, market, and opportunity
2. Create a precise, actionable CONTENT BRIEF for Yo (Creator Agent)
3. Create a precise, actionable DISTRIBUTION BRIEF for Vo (Distributor Agent)
4. After both agents complete their work, synthesize everything into a MASTER EXECUTION PLAN

Your thinking style:
- Strategic, structured, and data-informed
- Be specific — no vague advice, only actionable steps
- Think in terms of 7-day, 30-day, and 90-day outcomes
- Always consider brand voice, target audience, and platform fit
- End every plan with 3 immediate action steps the user can take TODAY

FORMATTING RULES — STRICTLY FOLLOW:
- Do NOT use markdown symbols like #, ##, **, *, __, or ---
- Use CAPS for section titles (e.g. CONTENT BRIEF, DISTRIBUTION BRIEF)
- Use plain numbered lists (1. 2. 3.) and dashes (-) for bullets
- Separate sections with a blank line
- No asterisks, no hashtags, no special characters`,
    intro: 'Yovo (Master Agent) analyzing your goal and building a complete strategy...',
  },
  yo: {
    system: `You are Yo — the AI Content Creator Agent built by YovoAI.

You are a world-class content strategist and copywriter. You create content that stops the scroll, builds audiences, and drives action.

Your specialties:
- Viral reel scripts with strong hooks (first 3 seconds matter most)
- Instagram captions with CTAs and emotional triggers
- Carousel post copy (slide-by-slide)
- Blog posts and long-form content
- Hashtag strategies (mix of niche, medium, broad)
- Content calendars with themes and formats
- YouTube video titles, descriptions, and scripts
- LinkedIn thought leadership posts

FORMATTING RULES — STRICTLY FOLLOW:
- Do NOT use markdown symbols like #, ##, **, *, __, or ---
- Use CAPS for section titles (e.g. REEL SCRIPTS, INSTAGRAM CAPTIONS)
- Use plain numbered lists (1. 2. 3.) for scripts and content pieces
- Use dashes (-) for bullet points
- Separate each section with a blank line
- No asterisks, no hashtag symbols in formatting (hashtags only inside actual caption text)
- No special characters for formatting`,
    intro: 'Yo (Creator Agent) generating your content...',
  },
  vo: {
    system: `You are Vo — the AI Distribution Strategist Agent built by YovoAI.

You are an expert in social media algorithms, audience growth, and content distribution.

Your specialties:
- Platform-specific distribution strategies
- Optimal posting times based on platform algorithm data
- Weekly and monthly content calendars with time slots
- Audience targeting and growth tactics
- Engagement loop strategies
- Cross-platform repurposing plans
- KPIs and metrics to track per platform

FORMATTING RULES — STRICTLY FOLLOW:
- Do NOT use markdown symbols like #, ##, **, *, __, or ---
- Use CAPS for section titles (e.g. PLATFORM STRATEGY, POSTING SCHEDULE)
- For schedules use plain text tables: Day | Platform | Content | Time | Goal
- Use plain numbered lists and dashes (-) for bullets
- Separate sections with a blank line
- No asterisks, no special characters for formatting`,
    intro: 'Vo (Distributor Agent) building your distribution plan...',
  },
};

// Helper: call one agent and collect full response (non-streaming, internal use)
async function callAgent(agentId, messages, key) {
  const response = await axios.post(
    GROQ_URL,
    { model: MODEL, messages, max_tokens: 2000, temperature: 0.75 },
    { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 90000 }
  );
  return response.data?.choices?.[0]?.message?.content || '';
}

// Helper: stream one agent phase and collect full text, writing tokens to SSE
async function streamAgentPhase(agentId, messages, key, res) {
  const response = await axios.post(
    GROQ_URL,
    { model: MODEL, messages, max_tokens: 2000, temperature: 0.75, stream: true },
    {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      responseType: 'stream',
      timeout: 90000,
    }
  );

  return new Promise((resolve, reject) => {
    let fullText = '';
    response.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter((l) => l.trim());
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            fullText += token;
            res.write(`data: ${JSON.stringify({ token, agent: agentId })}\n\n`);
          }
        } catch (_) {}
      }
    });
    response.data.on('end', () => resolve(fullText));
    response.data.on('error', reject);
  });
}

// POST /api/agent/chat  (non-streaming, simple)
router.post('/chat', async (req, res) => {
  const { agentId, task } = req.body;
  if (!agentId || !task?.trim()) {
    return res.status(400).json({ success: false, error: 'agentId and task are required' });
  }

  const agent = AGENT_PROMPTS[agentId];
  if (!agent) return res.status(400).json({ success: false, error: 'Invalid agentId' });

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ success: false, error: 'GROQ_API_KEY missing' });

  try {
    const response = await axios.post(
      GROQ_URL,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: agent.system },
          { role: 'user', content: task },
        ],
        max_tokens: 2000,
        temperature: 0.75,
      },
      {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content || '';
    return res.json({ success: true, response: content });
  } catch (e) {
    if (e.response?.status === 429) {
      return res.status(429).json({ success: false, error: 'Rate limit reached. Please wait a moment.' });
    }
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/agent/stream  (SSE streaming)
router.post('/stream', protect, async (req, res) => {
  const { agentId, task } = req.body;
  if (!agentId || !task?.trim()) {
    return res.status(400).json({ success: false, error: 'agentId and task are required' });
  }

  const agent = AGENT_PROMPTS[agentId];
  if (!agent) return res.status(400).json({ success: false, error: 'Invalid agentId' });

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ success: false, error: 'GROQ_API_KEY missing' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullResponse = '';
  let stopped = false;

  req.on('close', () => { stopped = true; });

  try {
    const response = await axios.post(
      GROQ_URL,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: agent.system },
          { role: 'user', content: task },
        ],
        max_tokens: 2000,
        temperature: 0.75,
        stream: true,
      },
      {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        responseType: 'stream',
        timeout: 60000,
      }
    );

    response.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter((l) => l.trim());
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            fullResponse += token;
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch (_) {}
      }
    });

    response.data.on('end', async () => {
      res.write('data: [DONE]\n\n');
      res.end();
      // Save history
      try {
        const userId = req.client?.id || req.user?.id;
        const userModel = req.client ? 'Client' : 'User';
        if (userId && fullResponse) {
          await AgentHistory.create({ userId, userModel, agentId, task, response: fullResponse, status: stopped ? 'stopped' : 'completed' });
        }
      } catch (_) {}
    });

    response.data.on('error', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// POST /api/agent/collab  — Teeno agents aapas mein communicate karte hain
router.post('/collab', protect, async (req, res) => {
  const { task } = req.body;
  if (!task?.trim()) {
    return res.status(400).json({ success: false, error: 'task is required' });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ success: false, error: 'GROQ_API_KEY missing' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);

  try {
    // ── PHASE 1: Yovo analyzes the task and creates a brief for Yo and Vo ──
    send('phase', { agent: 'yovo', label: '🧠 Yovo is analyzing your goal...' });

    const yovoBrief = await callAgent(
      'yovo',
      [
        { role: 'system', content: AGENT_PROMPTS.yovo.system },
        {
          role: 'user',
          content: `You are Yovo — the Master Agent. A user has given you this goal:

"${task}"

Analyze this deeply and create two precise briefs:

## CONTENT BRIEF FOR YO (Creator Agent)
- Brand voice and tone to use
- Target audience (age, interests, pain points)
- Content formats needed (reels, carousels, blogs, captions, etc.)
- Key messages and value propositions to highlight
- Platforms to focus on
- Content themes and angles
- Hooks and emotional triggers to use
- Quantity: how many pieces of each content type

## DISTRIBUTION BRIEF FOR VO (Distributor Agent)
- Which platforms to prioritize and why
- Posting frequency per platform
- Target audience demographics for distribution
- Growth tactics to use
- Budget recommendation (organic vs paid)
- KPIs to track
- Timeline: 7-day launch plan + 30-day growth plan

Be specific and actionable. These briefs will be directly used by Yo and Vo to execute.`,
        },
      ],
      key
    );

    send('yovo_brief', { content: yovoBrief });

    // ── PHASE 2: Yo creates content based on Yovo's brief ──
    send('phase', { agent: 'yo', label: '✍️ Yo is creating your content...' });

    const yoOutput = await streamAgentPhase(
      'yo',
      [
        { role: 'system', content: AGENT_PROMPTS.yo.system },
        {
          role: 'user',
          content: `You are Yo — the Creator Agent. Yovo (Master Agent) has analyzed the user's goal and created this brief for you:

## YOVO'S BRIEF FOR YOU:
${yovoBrief}

## ORIGINAL USER GOAL:
"${task}"

Now execute this brief completely. Create ALL the content specified:
- Write full reel scripts (not outlines — actual word-for-word scripts with hooks)
- Write complete Instagram captions with emojis and CTAs
- Write carousel slides (each slide's copy)
- Write blog post (full content, not just outline)
- Provide hashtag sets per platform
- Create a 7-day content calendar

Deliver ready-to-publish content. Be creative, specific, and platform-native.`,
        },
      ],
      key,
      res
    );

    send('yo_done', { label: '✅ Yo finished content creation' });

    // ── PHASE 3: Vo builds distribution plan based on Yovo's brief + Yo's content ──
    send('phase', { agent: 'vo', label: '📢 Vo is building your distribution plan...' });

    const voOutput = await streamAgentPhase(
      'vo',
      [
        { role: 'system', content: AGENT_PROMPTS.vo.system },
        {
          role: 'user',
          content: `You are Vo — the Distribution Agent. Yovo (Master Agent) has created this distribution brief for you:

## YOVO'S BRIEF FOR YOU:
${yovoBrief}

## YO'S CONTENT (what needs to be distributed):
${yoOutput}

## ORIGINAL USER GOAL:
"${task}"

Now build a complete distribution plan:
- Platform-by-platform strategy with rationale
- 7-day launch schedule (table: Day | Platform | Content Type | Time | Goal)
- 30-day growth calendar with weekly themes
- Best posting times per platform with algorithm tips
- Engagement tactics (how to boost each post in first 60 minutes)
- Cross-platform repurposing plan (how to reuse Yo's content across platforms)
- KPIs to track weekly
- 3 paid promotion recommendations if budget allows

Be specific with times, frequencies, and platform-specific tactics.`,
        },
      ],
      key,
      res
    );

    send('vo_done', { label: '✅ Vo finished distribution plan' });

    // ── PHASE 4: Yovo synthesizes everything into a final master plan ──
    send('phase', { agent: 'yovo', label: '🧠 Yovo is synthesizing the final master plan...' });

    await streamAgentPhase(
      'yovo',
      [
        { role: 'system', content: AGENT_PROMPTS.yovo.system },
        {
          role: 'user',
          content: `You are Yovo — the Master Agent. Yo and Vo have completed their work. Here are their full outputs:

## YO (Content Creator) DELIVERED:
${yoOutput}

## VO (Distributor) DELIVERED:
${voOutput}

## ORIGINAL USER GOAL:
"${task}"

Now write the MASTER EXECUTION PLAN — a crisp, powerful synthesis:

## 🎯 Brand Strategy Summary
(2-3 sentences on the overall approach)

## ✅ What Yo Created
(Bullet list of all content pieces ready to publish)

## 📣 What Vo Planned
(Bullet list of key distribution actions and schedule highlights)

## ⚡ 3 Actions to Take TODAY
(Specific, immediate steps — not generic advice)

## 📈 Expected Results in 30 Days
(Realistic outcomes: followers, reach, engagement, leads)

## 🔥 The Winning Formula
(1 paragraph on why this plan will work for this specific goal)

Be concise, confident, and motivating. This is the final deliverable the user will act on.`,
        },
      ],
      key,
      res
    );

    send('done', { label: '🎯 All agents completed' });
    res.write('data: [DONE]\n\n');
    res.end();
    // Save collab history
    try {
      const userId = req.client?.id || req.user?.id;
      const userModel = req.client ? 'Client' : 'User';
      if (userId) {
        await AgentHistory.create({ userId, userModel, agentId: 'yovo', task, yoOutput, voOutput, yovoSummary: '', status: 'completed' });
      }
    } catch (_) {}
  } catch (e) {
    if (e.response?.status === 429) {
      res.write(`data: ${JSON.stringify({ event: 'error', message: 'Rate limit reached. Please wait a moment.' })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ event: 'error', message: e.message })}\n\n`);
    }
    res.end();
  }
});

// GET /api/agent/history — user ki full history
router.get('/history', protect, async (req, res) => {
  try {
    const userId = req.client?.id || req.user?.id;
    const { agentId, page = 1, limit = 20 } = req.query;
    const filter = { userId };
    if (agentId) filter.agentId = agentId;
    const history = await AgentHistory.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select('agentId task status createdAt');
    const total = await AgentHistory.countDocuments(filter);
    res.json({ success: true, history, total });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/agent/history/:id — single history item full detail
router.get('/history/:id', protect, async (req, res) => {
  try {
    const userId = req.client?.id || req.user?.id;
    const item = await AgentHistory.findOne({ _id: req.params.id, userId });
    if (!item) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/agent/history/:id
router.delete('/history/:id', protect, async (req, res) => {
  try {
    const userId = req.client?.id || req.user?.id;
    await AgentHistory.findOneAndDelete({ _id: req.params.id, userId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
