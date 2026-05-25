const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const axios = require('axios');

router.post('/campaign-fill', async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ success: false, message: 'topic is required' });

  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() + 1);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 30);

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'user',
          content: `You are a marketing expert. Generate campaign details for the topic: "${topic}".
Return ONLY a valid JSON object with no markdown or explanation:
{
  "campaignName": "catchy campaign name",
  "brandName": "relevant brand name",
  "goal": "campaign goal in one line",
  "description": "2-3 sentence campaign description",
  "tags": "tag1,tag2,tag3,tag4",
  "category": "one of: Fashion & Lifestyle, Beauty & Cosmetics, Health & Wellness, Travel & Tourism, Food & Beverages, Tech & Gadgets, Finance & Investing, Education & EdTech, Gaming & eSports, Fitness & Sports, Music & Entertainment, Startups & Entrepreneurship, Home Decor & Interiors, Non-Profit & Social Causes — pick the most relevant one",
  "credits": 50,
  "location": "India",
  "limit": 100,
  "views": 10000,
  "cutoff": 500,
  "tNc": "brief terms and conditions",
  "startDate": "${startDate.toISOString().split('T')[0]}",
  "startTime": "09:00",
  "endDate": "${endDate.toISOString().split('T')[0]}",
  "endTime": "23:59"
}`,
        },
      ],
      temperature: 0.7,
    });

    const text = completion.choices[0]?.message?.content?.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ success: false, message: 'AI response parse failed' });

    const data = JSON.parse(jsonMatch[0]);

    // Generate campaign image using Pollinations.ai (free, no key needed)
    const imagePrompt = encodeURIComponent(
      `professional marketing campaign banner for ${data.campaignName}, ${data.category}, vibrant colors, modern design, no text`
    );
    data.imageUrl = `https://image.pollinations.ai/prompt/${imagePrompt}?width=800&height=450&nologo=true&seed=${Date.now()}`;

    res.json({ success: true, data });
  } catch (err) {
    console.error('AI campaign fill error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/news-blog-fill', async (req, res) => {
  const { topic, category } = req.body;
  if (!topic) return res.status(400).json({ success: false, message: 'topic is required' });
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `You are a professional content writer for YovoAI — an influencer marketing platform in India.
Write a ${category || 'Blog'} post about: "${topic}".
Return ONLY a valid JSON object with no markdown, no explanation:
{
  "title": "engaging post title",
  "summary": "3-4 sentence engaging summary for listing preview (80-120 words)",
  "content": "full detailed post content (700-900 words, multiple paragraphs, professional tone)",
  "tags": "tag1,tag2,tag3,tag4,tag5",
  "author": "YovoAI Team",
  "imagePrompt": "a short visual description for image generation (no text in image)"
}`,
      }],
      temperature: 0.75,
    });
    const text = completion.choices[0]?.message?.content?.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ success: false, message: 'AI response parse failed' });
    const data = JSON.parse(jsonMatch[0]);
    res.json({ success: true, data });
  } catch (err) {
    console.error('AI news-blog fill error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
