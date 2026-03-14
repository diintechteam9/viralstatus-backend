const axios = require("axios");
const Message = require("../../models/whatsapp/message");
const { getIO } = require("../../socket");
require("dotenv").config();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;

const normalizePhone = (to) => {
  let digits = String(to).replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
};

const emitMessage = (waID, payload) => {
  const io = getIO();
  if (io) io.to(waID).emit("message", payload);
};

const sendTextMessage = async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ success: false, message: "Phone number (to) and message are required" });
    }

    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
      return res.status(500).json({ success: false, message: "WhatsApp API not configured" });
    }

    const formattedPhone = normalizePhone(to);

    if (formattedPhone.length < 10 || formattedPhone.length > 15) {
      return res.status(400).json({ success: false, message: "Invalid phone number format." });
    }

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to: formattedPhone, type: "text", text: { body: message } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );

    console.log('[WhatsApp] Graph API response:', JSON.stringify(response.data || {}, null, 2));

    const graphMessageId = response.data?.messages?.[0]?.id;
    if (!graphMessageId) {
      return res.status(502).json({ success: false, message: "WhatsApp API did not return a message id", data: response.data });
    }

    const waIDToSave = response.data.contacts?.[0]?.wa_id || formattedPhone;

    try {
      await Message.create({
        waID: waIDToSave,
        direction: "sent",
        type: "text",
        text: message,
        messageId: graphMessageId,
        status: "sent",
        timestamp: new Date()
      });
      console.log("Message saved to database with wa_id:", waIDToSave);

      emitMessage(waIDToSave, {
        waID: waIDToSave,
        direction: "sent",
        type: "text",
        text: message,
        messageId: graphMessageId,
        status: "sent",
        timestamp: new Date()
      });
    } catch (dbError) {
      console.error("Error saving message to database:", dbError.message);
      return res.status(500).json({
        success: false,
        message: "Message sent but failed to save to database",
        error: dbError.message,
        messageId: graphMessageId
      });
    }

    return res.status(200).json({ success: true, message: "Message sent successfully", to: formattedPhone, messageId: graphMessageId, data: response.data });

  } catch (error) {
    console.error("Error sending WhatsApp message:", error.response?.data || error.message);
    const errorData = error.response?.data;
    let errorMessage = "Failed to send message";
    let statusCode = 500;

    if (errorData?.error?.code === 131026) { errorMessage = "Recipient not registered on WhatsApp"; statusCode = 400; }
    else if (errorData?.error?.code === 131021) { errorMessage = "Recipient cannot be messaged"; statusCode = 400; }
    else if (errorData?.error?.code === 131047) { errorMessage = "Message undeliverable"; statusCode = 400; }
    else if (errorData?.error?.message) { errorMessage = errorData.error.message; }

    return res.status(statusCode).json({ success: false, message: errorMessage, error: errorData || error.message });
  }
};

const sendMediaMessage = async (req, res) => {
  try {
    const { to, mediaUrl, mediaType, caption } = req.body;

    if (!to || !mediaUrl || !mediaType) {
      return res.status(400).json({ success: false, message: "Phone number (to), mediaUrl, and mediaType are required" });
    }

    const formattedPhone = normalizePhone(to);

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: mediaType,
        [mediaType]: { link: mediaUrl, ...(caption && { caption }) }
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );

    const graphMessageId = response.data?.messages?.[0]?.id;
    const waIDToSave = response.data.contacts?.[0]?.wa_id || formattedPhone;

    try {
      await Message.create({
        waID: waIDToSave,
        direction: "sent",
        type: "media",
        mediaType,
        mediaUrl,
        text: caption || undefined,
        messageId: graphMessageId,
        status: "sent",
        timestamp: new Date()
      });
      console.log("Media message saved to database with wa_id:", waIDToSave);

      emitMessage(waIDToSave, {
        waID: waIDToSave,
        direction: "sent",
        type: "media",
        mediaType,
        mediaUrl,
        text: caption || undefined,
        messageId: graphMessageId,
        status: "sent",
        timestamp: new Date()
      });
    } catch (dbError) {
      console.error("Error saving media message:", dbError.message);
      return res.status(500).json({ success: false, message: "Media sent but failed to save", error: dbError.message, messageId: graphMessageId });
    }

    return res.status(200).json({ success: true, message: "Media message sent successfully", messageId: graphMessageId, data: response.data });

  } catch (error) {
    console.error("Error sending media message:", error.response?.data || error.message);
    return res.status(500).json({ success: false, message: "Failed to send media message", error: error.response?.data || error.message });
  }
};

const getMessageStatus = async (req, res) => {
  try {
    const { messageId } = req.params;
    if (!messageId) return res.status(400).json({ success: false, message: "Message ID is required" });

    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${messageId}`,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );

    return res.status(200).json({ success: true, status: response.data });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to get message status", error: error.response?.data || error.message });
  }
};

const sendInteractiveMessage = async (req, res) => {
  try {
    const { to, type, header, body, footer, action } = req.body;

    if (!to || !type || !body || !action) {
      return res.status(400).json({ success: false, message: "Phone number (to), type, body, and action are required" });
    }

    const formattedPhone = normalizePhone(to);

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "interactive",
        interactive: {
          type,
          ...(header && { header }),
          body: { text: body },
          ...(footer && { footer }),
          action
        }
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );

    const graphMessageId = response.data?.messages?.[0]?.id;
    const waIDToSave = response.data.contacts?.[0]?.wa_id || formattedPhone;

    try {
      await Message.create({
        waID: waIDToSave,
        direction: "sent",
        type: "interactive",
        text: body,
        messageId: graphMessageId,
        status: "sent",
        timestamp: new Date()
      });
      console.log("Interactive message saved to database with wa_id:", waIDToSave);

      emitMessage(waIDToSave, {
        waID: waIDToSave,
        direction: "sent",
        type: "interactive",
        text: body,
        messageId: graphMessageId,
        status: "sent",
        timestamp: new Date()
      });
    } catch (dbError) {
      console.error("Error saving interactive message:", dbError.message);
      return res.status(500).json({ success: false, message: "Interactive message sent but failed to save", error: dbError.message, messageId: graphMessageId });
    }

    return res.status(200).json({ success: true, message: "Interactive message sent successfully", messageId: graphMessageId, data: response.data });

  } catch (error) {
    console.error("Error sending interactive message:", error.response?.data || error.message);
    return res.status(500).json({ success: false, message: "Failed to send interactive message", error: error.response?.data || error.message });
  }
};

module.exports = { sendTextMessage, sendMediaMessage, getMessageStatus, sendInteractiveMessage };
