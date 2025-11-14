const axios = require("axios");
const Message = require("../../models/whatsapp/message");
require("dotenv").config();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;

/**
 * Send a text message to a WhatsApp user
 */

const sendTextMessage = async (req, res) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({
        success: false,
        message: "Phone number (to) and message are required"
      });
    }

    // Format phone number (remove + if present and add country code if missing)
    let formattedPhone = to.replace('+', '');
    if (!formattedPhone.startsWith('91')) {
      formattedPhone = '91' + formattedPhone; // Default to India (+91)
    }

    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    
    const payload = {
      messaging_product: "whatsapp",
      to: formattedPhone,
      type: "text",
      text: {
        body: message
      }
    };

    const headers = {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    };

    const response = await axios.post(url, payload, { headers });

    // Save the sent message to MongoDB
    try {
      // Get wa_id from WhatsApp API response
      const waIdFromResponse = response.data.contacts?.[0]?.wa_id;
      
      // Use wa_id from response if available, otherwise fallback to formatted phone
      const waIDToSave = waIdFromResponse || (to.startsWith('+') ? to.substring(1) : to);
      
      const messageData = {
        waID: waIDToSave, // Save the wa_id from WhatsApp response
        direction: 'sent',
        type: 'text',
        text: message,
        messageId: response.data.messages?.[0]?.id,
        status: 'sent',
        timestamp: new Date()
      };
      
      const savedMessage = await Message.create(messageData);
      console.log('Message saved to database successfully with wa_id:', waIDToSave);
    } catch (dbError) {
      console.error('Error saving message to database:', dbError.message);
      console.error('Full error:', dbError);
      // Don't fail the request if database save fails
    }

    return res.status(200).json({
      success: true,
      message: "Message sent successfully",
      messageId: response.data.messages?.[0]?.id,
      data: response.data
    });

  } catch (error) {
    console.error("Error sending WhatsApp message:", error.response?.data || error.message);
    
    // Check for specific WhatsApp API errors
    const errorData = error.response?.data;
    let errorMessage = "Failed to send message";
    let statusCode = 500;
    
    if (errorData) {
      // Handle WhatsApp Business API specific errors
      if (errorData.error?.code === 131026) {
        errorMessage = "Recipient phone number is not registered on WhatsApp";
        statusCode = 400;
      } else if (errorData.error?.code === 131021) {
        errorMessage = "Recipient cannot be messaged";
        statusCode = 400;
      } else if (errorData.error?.code === 131047) {
        errorMessage = "Message undeliverable";
        statusCode = 400;
      } else if (errorData.error?.message) {
        errorMessage = errorData.error.message;
      }
    }
    
    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: errorData || error.message,
      whatsappError: errorData?.error
    });
  }
};

/**
 * Send a media message (image, document, audio, video)
 */
const sendMediaMessage = async (req, res) => {
  try {
    const { to, mediaUrl, mediaType, caption } = req.body;

    if (!to || !mediaUrl || !mediaType) {
      return res.status(400).json({
        success: false,
        message: "Phone number (to), mediaUrl, and mediaType are required"
      });
    }

    // Format phone number
    let formattedPhone = to.replace('+', '');
    if (!formattedPhone.startsWith('91')) {
      formattedPhone = '91' + formattedPhone;
    }

    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    
    const payload = {
      messaging_product: "whatsapp",
      to: formattedPhone,
      type: mediaType,
      [mediaType]: {
        link: mediaUrl,
        ...(caption && { caption })
      }
    };

    const headers = {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    };

    const response = await axios.post(url, payload, { headers });

    // Save the sent media message to MongoDB
    try {
      // Get wa_id from WhatsApp API response
      const waIdFromResponse = response.data.contacts?.[0]?.wa_id;
      
      // Use wa_id from response if available, otherwise fallback to formatted phone
      const waIDToSave = waIdFromResponse || (to.startsWith('+') ? to.substring(1) : to);
      
      const messageData = {
        waID: waIDToSave, // Save the wa_id from WhatsApp response
        direction: 'sent',
        type: 'media',
        mediaType: mediaType,
        mediaUrl: mediaUrl,
        text: caption || undefined,
        messageId: response.data.messages?.[0]?.id,
        status: 'sent',
        timestamp: new Date()
      };
      
      const savedMessage = await Message.create(messageData);
      console.log('Media message saved to database successfully with wa_id:', waIDToSave);
    } catch (dbError) {
      console.error('Error saving media message to database:', dbError.message);
      console.error('Full error:', dbError);
      // Don't fail the request if database save fails
    }

    return res.status(200).json({
      success: true,
      message: "Media message sent successfully",
      messageId: response.data.messages?.[0]?.id,
      data: response.data
    });

  } catch (error) {
    console.error("Error sending media message:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send media message",
      error: error.response?.data || error.message
    });
  }
};

/**
 * Get message status and delivery information
 */
const getMessageStatus = async (req, res) => {
  try {
    const { messageId } = req.params;

    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: "Message ID is required"
      });
    }

    const url = `https://graph.facebook.com/v18.0/${messageId}`;
    const headers = {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    };

    const response = await axios.get(url, { headers });

    return res.status(200).json({
      success: true,
      message: "Message status retrieved successfully",
      status: response.data
    });

  } catch (error) {
    console.error("Error getting message status:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to get message status",
      error: error.response?.data || error.message
    });
  }
};

/**
 * Send interactive message (buttons, lists, etc.)
 */
const sendInteractiveMessage = async (req, res) => {
  try {
    const { to, type, header, body, footer, action } = req.body;

    if (!to || !type || !body || !action) {
      return res.status(400).json({
        success: false,
        message: "Phone number (to), type, body, and action are required"
      });
    }

    // Format phone number
    let formattedPhone = to.replace('+', '');
    if (!formattedPhone.startsWith('91')) {
      formattedPhone = '91' + formattedPhone;
    }

    const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    
    const payload = {
      messaging_product: "whatsapp",
      to: formattedPhone,
      type: "interactive",
      interactive: {
        type,
        ...(header && { header }),
        body: {
          text: body
        },
        ...(footer && { footer }),
        action
      }
    };

    const headers = {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    };

    const response = await axios.post(url, payload, { headers });

    // Save the sent interactive message to MongoDB
    try {
      // Get wa_id from WhatsApp API response
      const waIdFromResponse = response.data.contacts?.[0]?.wa_id;
      
      // Use wa_id from response if available, otherwise fallback to formatted phone
      const waIDToSave = waIdFromResponse || (to.startsWith('+') ? to.substring(1) : to);
      
      const messageData = {
        waID: waIDToSave, // Save the wa_id from WhatsApp response
        direction: 'sent',
        type: 'interactive',
        text: body,
        messageId: response.data.messages?.[0]?.id,
        status: 'sent',
        timestamp: new Date()
      };
      
      const savedMessage = await Message.create(messageData);
      console.log('Interactive message saved to database successfully with wa_id:', waIDToSave);
    } catch (dbError) {
      console.error('Error saving interactive message to database:', dbError.message);
      console.error('Full error:', dbError);
      // Don't fail the request if database save fails
    }

    return res.status(200).json({
      success: true,
      message: "Interactive message sent successfully",
      messageId: response.data.messages?.[0]?.id,
      data: response.data
    });

  } catch (error) {
    console.error("Error sending interactive message:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to send interactive message",
      error: error.response?.data || error.message
    });
  }
};

module.exports = {
  sendTextMessage,
  sendMediaMessage,
  getMessageStatus,
  sendInteractiveMessage
};
