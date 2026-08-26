const express = require('express');
const router = express.Router();
const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-70b-versatile';

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

const callGroq = async (system, user, maxTokens = 3000) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const payload = { model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.75, response_format: { type: 'json_object' } };
  try {
    const r = await axios.post(GROQ_URL, payload, { headers, timeout: 35000 });
    return r.data?.choices?.[0]?.message?.content || '';
  } catch (e) {
    if (e.response?.data?.error?.message?.toLowerCase().includes('failed')) {
      const r2 = await axios.post(GROQ_URL, { ...payload, response_format: undefined, temperature: 0.3 }, { headers, timeout: 35000 });
      return r2.data?.choices?.[0]?.message?.content || '';
    }
    throw e;
  }
};

router.post('/generate', async (req, res) => {
  const { pageType = 'Portfolio', businessName, productName = '', description = '', tone = 'Professional', language = 'English' } = req.body;
  if (!businessName?.trim()) return res.status(400).json({ success: false, error: 'Name is required' });

  const isEcommerce = pageType.toLowerCase().includes('e-commerce');
  const system = `You are a world-class web designer and copywriter. You create stunning landing page content. Always respond in ${language}. Return valid JSON only.`;

  const user = isEcommerce
    ? `Create a high-converting e-commerce product landing page in ${language}.
Brand: "${businessName}", Product: "${productName || businessName}"
Description: "${description || 'premium quality product'}"
Tone: ${tone}

Return JSON:
{
  "meta": { "name": "${businessName}", "tagline": "short tagline", "primaryColor": "#hex (pick a fitting brand color)" },
  "nav": { "logo": "${businessName}", "links": ["Home","Products","About","Contact"] },
  "hero": { "headline": "powerful benefit-driven headline", "subheadline": "supporting headline", "description": "2-3 sentence description", "primaryCta": "Buy Now", "secondaryCta": "Learn More", "trustBadge": "10,000+ Happy Customers" },
  "about": { "title": "About Us", "description": "2-3 sentences about the brand story and mission", "stats": [{"label":"Customers","value":"10K+"},{"label":"Products","value":"50+"},{"label":"Rating","value":"4.9★"}] },
  "features": { "title": "Why Choose Us", "items": [{"icon":"emoji","title":"feature","description":"benefit"}] },
  "products": { "title": "Our Products", "items": [{"name":"product name","price":"₹999","originalPrice":"₹1499","description":"short desc","badge":"Best Seller","icon":"emoji"}] },
  "testimonials": { "title": "Customer Reviews", "items": [{"quote":"testimonial","name":"name","role":"Verified Buyer","rating":5}] },
  "cta": { "headline": "Ready to Order?", "subtext": "Free shipping on orders above ₹499", "buttonText": "Shop Now", "urgency": "Limited stock available" },
  "faq": { "title": "FAQs", "items": [{"question":"q","answer":"a"}] },
  "contact": { "title": "Get In Touch", "email": "hello@${businessName.toLowerCase().replace(/\s/g,'')}.com", "phone": "+91 98765 43210", "address": "Mumbai, India" },
  "footer": { "tagline": "short footer tagline", "socialLinks": [{"platform":"Instagram","url":"#"},{"platform":"Facebook","url":"#"}] }
}
features: 4 items, products: 3 items, testimonials: 3 items, faq: 4 items.`
    : `Create a stunning portfolio/service landing page in ${language}.
Name/Business: "${businessName}"
Description: "${description || 'professional services and expertise'}"
Tone: ${tone}

Return JSON:
{
  "meta": { "name": "${businessName}", "tagline": "short personal tagline", "primaryColor": "#6366f1" },
  "nav": { "logo": "${businessName}", "links": ["Home","About","Services","Portfolio","Contact"] },
  "hero": { "headline": "powerful headline about what you do", "subheadline": "who you help and how", "description": "2-3 sentence compelling intro", "primaryCta": "Hire Me", "secondaryCta": "View Work", "trustBadge": "Available for Projects" },
  "about": { "title": "About Me", "description": "3-4 sentences about background, passion, and expertise", "stats": [{"label":"Projects Done","value":"50+"},{"label":"Happy Clients","value":"30+"},{"label":"Experience","value":"5 Years"}] },
  "services": { "title": "What I Do", "items": [{"icon":"emoji","title":"service name","description":"what you deliver and the outcome"}] },
  "portfolio": { "title": "Recent Work", "items": [{"title":"project name","category":"category","description":"what was built and result","icon":"emoji"}] },
  "testimonials": { "title": "Client Testimonials", "items": [{"quote":"specific result-based testimonial","name":"client name","role":"company/designation","rating":5}] },
  "cta": { "headline": "Let's Work Together", "subtext": "I'm currently accepting new projects", "buttonText": "Start a Project", "urgency": "Limited spots available this month" },
  "faq": { "title": "Frequently Asked Questions", "items": [{"question":"common question","answer":"clear answer"}] },
  "contact": { "title": "Contact Me", "email": "hello@${businessName.toLowerCase().replace(/\s/g,'')}.com", "phone": "+91 98765 43210", "address": "Available Worldwide (Remote)" },
  "footer": { "tagline": "short inspiring footer tagline", "socialLinks": [{"platform":"LinkedIn","url":"#"},{"platform":"GitHub","url":"#"},{"platform":"Twitter","url":"#"}] }
}
services: 4 items with emojis, portfolio: 3 items, testimonials: 3 items, faq: 4 items.`;

  try {
    const raw = await callGroq(system, user, 3000);
    const parsed = extractJson(raw);
    if (!parsed?.hero) return res.status(500).json({ success: false, error: 'Failed to parse response. Please try again.' });
    return res.json({ success: true, isEcommerce, ...parsed });
  } catch (e) {
    const status = e.response?.status;
    if (status === 429) return res.status(429).json({ success: false, error: 'Rate limit reached. Please wait a moment.' });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
