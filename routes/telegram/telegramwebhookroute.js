const express = require('express');
const router = express.Router();
const TelegramWebhookController = require('../../controllers/telegram/telegramWebhookController');
const TelegramMessage = require('../../models/telegram/TelegramMessage');
const axios = require('axios');
require('dotenv').config();

const telegramWebhook = new TelegramWebhookController();

// Webhook endpoint - Telegram will POST updates here
router.post('/webhook', async (req, res) => {
  try {
    if (!telegramWebhook.verifySecretToken(req)) {
      console.warn('Webhook request with invalid secret token');
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const result = await telegramWebhook.handleUpdate(req.body);

    if (result.success) {
      res.status(200).json({ ok: true });
    } else {
      console.error('Error handling webhook update:', result.error);
      res.status(200).json({ ok: true });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ ok: true });
  }
});

// Register webhook with Telegram
router.post('/register-webhook', async (req, res) => {
  try {
    const { webhookUrl, secretToken } = req.body;
    const botToken = process.env.TELEGRAMBOT_API_KEY;

    if (!botToken) {
      return res.status(400).json({
        success: false,
        error: 'TELEGRAMBOT_API_KEY not configured'
      });
    }

    const url = webhookUrl || process.env.TELEGRAM_WEBHOOK_URL || 'https://vs.yovoai.com/api/telegram/webhook';

    if (!url.startsWith('https://')) {
      return res.status(400).json({
        success: false,
        error: 'Webhook URL must use HTTPS'
      });
    }

    const webhookData = {
      url
    };

    if (secretToken) {
      webhookData.secret_token = secretToken;
    } else if (process.env.TELEGRAM_WEBHOOK_SECRET) {
      webhookData.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
    }

    const response = await axios.post(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      webhookData
    );

    if (response.data.ok) {
      res.json({
        success: true,
        message: 'Webhook registered successfully',
        webhookInfo: response.data.result,
        url
      });
    } else {
      res.status(400).json({
        success: false,
        error: response.data.description || 'Failed to register webhook'
      });
    }
  } catch (error) {
    console.error('Error registering webhook:', error);
    res.status(500).json({
      success: false,
      error: error.response?.data?.description || error.message
    });
  }
});

// Get webhook info
router.get('/webhook-info', async (req, res) => {
  try {
    const botToken = process.env.TELEGRAMBOT_API_KEY;

    if (!botToken) {
      return res.status(400).json({
        success: false,
        error: 'TELEGRAMBOT_API_KEY not configured'
      });
    }

    const response = await axios.get(
      `https://api.telegram.org/bot${botToken}/getWebhookInfo`
    );

    if (response.data.ok) {
      res.json({
        success: true,
        webhookInfo: response.data.result
      });
    } else {
      res.status(400).json({
        success: false,
        error: response.data.description || 'Failed to get webhook info'
      });
    }
  } catch (error) {
    console.error('Error getting webhook info:', error);
    res.status(500).json({
      success: false,
      error: error.response?.data?.description || error.message
    });
  }
});

// Delete webhook
router.post('/delete-webhook', async (req, res) => {
  try {
    const botToken = process.env.TELEGRAMBOT_API_KEY;

    if (!botToken) {
      return res.status(400).json({
        success: false,
        error: 'TELEGRAMBOT_API_KEY not configured'
      });
    }

    const response = await axios.post(
      `https://api.telegram.org/bot${botToken}/deleteWebhook`
    );

    if (response.data.ok) {
      res.json({
        success: true,
        message: 'Webhook deleted successfully',
        result: response.data.result
      });
    } else {
      res.status(400).json({
        success: false,
        error: response.data.description || 'Failed to delete webhook'
      });
    }
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(500).json({
      success: false,
      error: error.response?.data?.description || error.message
    });
  }
});

// Get messages from database
router.get('/messages', async (req, res) => {
  try {
    const { chatId, limit = 50, skip = 0, messageType } = req.query;

    const query = {};
    if (chatId) {
      query.chatId = String(chatId);
    }
    if (messageType) {
      query.messageType = messageType;
    }

    const messages = await TelegramMessage.find(query)
      .sort({ date: -1 })
      .limit(parseInt(limit, 10))
      .skip(parseInt(skip, 10))
      .lean();

    const total = await TelegramMessage.countDocuments(query);

    res.json({
      success: true,
      messages,
      total,
      limit: parseInt(limit, 10),
      skip: parseInt(skip, 10)
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get message by ID
router.get('/messages/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await TelegramMessage.findOne({ messageId: parseInt(messageId, 10) });

    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    res.json({
      success: true,
      message
    });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
