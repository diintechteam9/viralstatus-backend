const axios = require("axios");
require("dotenv").config();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v19.0";

/**
 * Send WhatsApp template message dynamically using values from req.body
 * Expects: { to: string, templateName: string, languageCode: string }
 */

const sendDynamicMessage = async (req, res) => {
  try {
    const { to, templateName, languageCode } = req.body;

    if (!to || !templateName || !languageCode) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields. Provide 'to', 'templateName', and 'languageCode'.",
      });
    }

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_ID}/messages`;
    const headers = {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    };

    const data = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: [],
          },
        ],
      },
    };

    const response = await axios.post(url, data, { headers });

    return res.status(200).json({
      success: true,
      message: "Template message sent successfully",
      response: response.data,
    });
  } catch (error) {
    console.error("Template send failed:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send message",
      error: error.response?.data || error.message,
    });
  }
};

module.exports = { sendDynamicMessage };


