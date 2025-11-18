const axios = require("axios");

const WHATSAPP_PHONE_ID=process.env.WHATSAPP_PHONE_ID;
const GRAPH_VERSION=process.env.GRAPH_VERSION;
const WHATSAPP_VERIFY_TOKEN=process.env.WHATSAPP_VERIFY_TOKEN;


const enableVoiceCall = async (req, res) => {
  try {

    if (!WHATSAPP_PHONE_ID || !WHATSAPP_VERIFY_TOKEN) {
      return res.status(400).json({ error: "Missing environment variables" });
    }

    // WhatsApp Graph API URL
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_ID}/settings`;

    // Body required to enable calling
    const payload = {
      voice: {
        // Enable calling API
        "enabled": true
      }
    };

    // Make the API request
    const response = await axios.post(url, payload, {
      headers: {
        "Authorization": `Bearer ${WHATSAPP_VERIFY_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    return res.status(200).json({
      success: true,
      message: "Calling feature enabled successfully",
      data: response.data,
    });

  } catch (error) {
    console.error("Error enabling calling:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
};

module.exports = { enableVoiceCall };