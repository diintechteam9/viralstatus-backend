const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');

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
    res.json({ success: true, data });
  } catch (err) {
    console.error('AI campaign fill error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
