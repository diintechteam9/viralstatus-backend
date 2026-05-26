/**
 * autoPostService.js
 * 5x daily (8AM, 11AM, 2PM, 5PM, 8PM IST) — 1 News + 1 Blog per run = 10 posts/day
 * Uses: Groq LLaMA-3.3-70B for content + Unsplash for images (Pollinations fallback)
 */

'use strict';

const Groq = require('groq-sdk');
const axios = require('axios');
const NewsBlog = require('../models/NewsBlog');

// ─── Lazy Groq init — ensures env is loaded before use ───────────────────────
let _groq = null;
function getGroq() {
  if (!_groq) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in environment');
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

// ─── Concurrency guard — prevent overlapping runs ────────────────────────────
let isRunning = false;

// ─── Used topic tracking — avoid same topic in same day ──────────────────────
const usedTopicsToday = { News: new Set(), Blog: new Set(), date: '' };

function getUsedSet(category) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (usedTopicsToday.date !== today) {
    usedTopicsToday.News.clear();
    usedTopicsToday.Blog.clear();
    usedTopicsToday.date = today;
  }
  return usedTopicsToday[category];
}

// ─── YovoAI focused topic pools ──────────────────────────────────────────────

const NEWS_TOPICS = [
  'YovoAI launches new influencer campaign feature for Indian brands',
  'How YovoAI is transforming UGC marketing in India 2025',
  'YovoAI platform reaches new milestone in creator economy',
  'Top influencer marketing trends powered by AI in India',
  'YovoAI helps brands measure ROI on influencer campaigns',
  'Rise of micro-influencers on YovoAI platform',
  'YovoAI introduces AI-powered content pool for brands',
  'How Indian startups are using YovoAI for growth marketing',
  'YovoAI expands to new categories: fashion, food, and tech',
  'Creator economy in India: YovoAI 2025 report',
  'YovoAI campaign analytics — what brands need to know',
  'How YovoAI verifies influencer content quality automatically',
  'YovoAI partners with top D2C brands for influencer campaigns',
  'Social media marketing automation with YovoAI tools',
  'YovoAI reel generator helps brands create viral content',
  'Influencer marketing ROI statistics India 2025',
  'How AI is changing content creation for Indian brands',
  'YovoAI credit system empowers creators across India',
  'Short video marketing trends on YovoAI platform',
  'YovoAI helps small businesses compete with big brands',
];

const BLOG_TOPICS = [
  'How to run a successful influencer campaign on YovoAI step by step',
  'Top 10 tips for brands using YovoAI for influencer marketing',
  'Why UGC content outperforms traditional ads — YovoAI insights',
  'Complete guide to setting up your first campaign on YovoAI',
  'How to choose the right influencers for your brand on YovoAI',
  'Measuring influencer campaign success with YovoAI analytics',
  'Content pool strategy: how brands win with YovoAI',
  'AI tools every influencer marketer should use in 2025',
  'How YovoAI credit wallet system rewards creators fairly',
  'Building brand awareness through micro-influencers on YovoAI',
  'Video content strategy for influencer campaigns on YovoAI',
  'How to write a winning campaign brief on YovoAI',
  'Instagram reels vs YouTube shorts — which works better for brands',
  'YovoAI onboarding guide for new brands and creators',
  'Future of influencer marketing: AI, automation, and authenticity',
  'How to track influencer campaign performance on YovoAI',
  'Best practices for UGC campaigns on YovoAI platform',
  'Why Indian D2C brands are choosing YovoAI for growth',
  'How to build a loyal creator community using YovoAI',
  'Content calendar strategy for influencer marketing in India',
];

// ─── Pick 1 unused random topic ───────────────────────────────────────────────

function pickUnusedTopic(pool, usedSet) {
  const available = pool.filter(t => !usedSet.has(t));
  // If all used (shouldn't happen with 20 topics and 5 runs), reset and pick any
  const source = available.length > 0 ? available : pool;
  const topic = source[Math.floor(Math.random() * source.length)];
  usedSet.add(topic);
  return topic;
}

// ─── Groq: generate post content with retry ──────────────────────────────────

async function generatePostContent(topic, category, attempt = 1) {
  const groq = getGroq();
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `You are a professional content writer for YovoAI — an AI-powered influencer marketing platform in India.
Write a ${category} post about: "${topic}".
Return ONLY a valid JSON object. No markdown, no code block, no explanation. Start directly with {
{
  "title": "engaging SEO-friendly title (max 80 chars)",
  "summary": "compelling 2-3 sentence summary (60-100 words)",
  "content": "full detailed post (600-900 words, 4-6 paragraphs, professional tone, mention YovoAI naturally)",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "imageQuery": "3-5 word Unsplash search query (e.g. influencer marketing india)"
}`,
      }],
      temperature: 0.75,
      max_tokens: 2000,
    });

    const text = completion.choices[0]?.message?.content?.trim() || '';
    // Extract JSON — handle cases where model wraps in ```json
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Groq response');

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!parsed.title || !parsed.content) throw new Error('Missing title or content in AI response');

    return parsed;
  } catch (err) {
    if (attempt < 3) {
      console.warn(`[AutoPost] Groq attempt ${attempt} failed for "${topic}": ${err.message} — retrying in 4s`);
      await new Promise(r => setTimeout(r, 4000));
      return generatePostContent(topic, category, attempt + 1);
    }
    throw err;
  }
}

// ─── Unsplash: fetch image with Pollinations fallback ────────────────────────

async function fetchImage(query) {
  // Try Unsplash first
  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const res = await axios.get('https://api.unsplash.com/photos/random', {
        params: { query, orientation: 'landscape', content_filter: 'high' },
        headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
        timeout: 8000,
      });
      const url = res.data?.urls?.regular || res.data?.urls?.small || '';
      if (url) return url;
    } catch (err) {
      console.warn(`[AutoPost] Unsplash failed for "${query}": ${err.message}`);
    }
  }

  // Fallback: Pollinations (free, no key needed)
  const encoded = encodeURIComponent(`${query} professional marketing digital`);
  return `https://image.pollinations.ai/prompt/${encoded}?width=800&height=450&nologo=true&seed=${Date.now()}`;
}

// ─── Generate and save one post ───────────────────────────────────────────────

async function generateAndSave(topic, category) {
  try {
    const data = await generatePostContent(topic, category);

    const imageQuery = (data.imageQuery || topic).slice(0, 60);
    const imageUrl = await fetchImage(imageQuery);

    const tags = Array.isArray(data.tags)
      ? data.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 8)
      : String(data.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 8);

    await NewsBlog.create({
      title: String(data.title).slice(0, 200),
      category,
      summary: String(data.summary || '').slice(0, 500),
      content: String(data.content || ''),
      author: 'YovoAI Team',
      tags,
      imageUrl,
      media: imageUrl ? [{ type: 'image', url: imageUrl, caption: String(data.title).slice(0, 200) }] : [],
      published: true,
    });

    console.log(`[AutoPost] ✅ ${category} saved: "${data.title}"`);
    return true;
  } catch (err) {
    console.error(`[AutoPost] ❌ Failed "${topic}" (${category}): ${err.message}`);
    return false;
  }
}

// ─── Main runner — 1 News + 1 Blog per call ──────────────────────────────────

async function runAutoPostJob() {
  // Prevent overlapping runs
  if (isRunning) {
    console.warn('[AutoPost] Job already running — skipping this trigger');
    return;
  }

  isRunning = true;
  const ist = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`\n[AutoPost] 🚀 Starting — ${ist} IST`);

  try {
    const newsTopic = pickUnusedTopic(NEWS_TOPICS, getUsedSet('News'));
    const blogTopic = pickUnusedTopic(BLOG_TOPICS, getUsedSet('Blog'));

    console.log(`[AutoPost] News topic: "${newsTopic}"`);
    await generateAndSave(newsTopic, 'News');

    // Gap between calls — Groq rate limit safe
    await new Promise(r => setTimeout(r, 4000));

    console.log(`[AutoPost] Blog topic: "${blogTopic}"`);
    await generateAndSave(blogTopic, 'Blog');

    const istDone = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    console.log(`[AutoPost] ✅ Done — ${istDone} IST\n`);
  } finally {
    isRunning = false;
  }
}

module.exports = { runAutoPostJob };
