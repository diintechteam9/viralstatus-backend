const axios = require('axios');
require('dotenv').config();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

async function submitTemplateToMeta(normalizedTemplate) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_BUSINESS_ACCOUNT_ID) {
    const err = new Error('Missing WHATSAPP_TOKEN or WHATSAPP_BUSINESS_ACCOUNT_ID');
    err.code = 'MISSING_CREDENTIALS';
    throw err;
  }

  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;
  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const payload = {
    name: normalizedTemplate.name,
    category: normalizedTemplate.category,
    parameter_format: normalizedTemplate.parameter_format,
    allow_category_change: normalizedTemplate.allow_category_change,
    language: normalizedTemplate.language,
    components: normalizedTemplate.components
  };

  // Remove undefined keys per Graph API expectations
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  const response = await axios.post(url, payload, { headers });
  return response.data;
}

module.exports = { submitTemplateToMeta };