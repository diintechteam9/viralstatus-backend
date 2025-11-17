const express = require('express');
const router = express.Router();
const TelegramServiceController = require('../controllers/telegramcontroller');
const TelegramSettings = require('../models/Settings');
const telegramService = new TelegramServiceController();

// Settings: get current Telegram alert toggles
router.get('/settings', async (req, res) => {
  try {
    let settings = await TelegramSettings.findOne();
    if (!settings) {
      settings = await TelegramSettings.create({});
    }
    res.json({
      success: true,
      settings: {
        telegramAlertsEnabledOnRegistration: settings.telegramAlertsEnabledOnRegistration,
        telegramAlertsEnabledOnProfileCreated: settings.telegramAlertsEnabledOnProfileCreated,
        telegramAlertsEnabledOnCampaignStart: settings.telegramAlertsEnabledOnCampaignStart,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Settings: update Telegram alert toggles
router.put('/settings', async (req, res) => {
  try {
    const {
      telegramAlertsEnabledOnRegistration,
      telegramAlertsEnabledOnProfileCreated,
      telegramAlertsEnabledOnCampaignStart,
    } = req.body || {};

    const update = {};
    if (typeof telegramAlertsEnabledOnRegistration === 'boolean') {
      update.telegramAlertsEnabledOnRegistration = telegramAlertsEnabledOnRegistration;
    }
    if (typeof telegramAlertsEnabledOnProfileCreated === 'boolean') {
      update.telegramAlertsEnabledOnProfileCreated = telegramAlertsEnabledOnProfileCreated;
    }
    if (typeof telegramAlertsEnabledOnCampaignStart === 'boolean') {
      update.telegramAlertsEnabledOnCampaignStart = telegramAlertsEnabledOnCampaignStart;
    }

    const settings = await TelegramSettings.findOneAndUpdate(
      {},
      Object.keys(update).length ? update : {},
      { new: true, upsert: true }
    );

    res.json({
      success: true,
      settings: {
        telegramAlertsEnabledOnRegistration: settings.telegramAlertsEnabledOnRegistration,
        telegramAlertsEnabledOnProfileCreated: settings.telegramAlertsEnabledOnProfileCreated,
        telegramAlertsEnabledOnCampaignStart: settings.telegramAlertsEnabledOnCampaignStart,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Telegram bot connection
router.post('/test-connection', async (req, res) => {
  try {
    const result = await telegramService.testConnection();
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



// Analyze video before sending (for debugging)
router.post('/analyze-video', async (req, res) => {
  try {
    const { videoBase64 } = req.body;
    
    if (!videoBase64) {
      return res.status(400).json({ 
        success: false, 
        error: 'Video data is required' 
      });
    }

    // Convert base64 video to buffer
    const videoBuffer = Buffer.from(videoBase64, 'base64');
    
    // Get video information
    const videoInfo = telegramService.getVideoInfo(videoBuffer);
    
    res.json({ 
      success: true, 
      videoInfo: videoInfo
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send only text message
router.post('/send-text', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ 
        success: false, 
        error: 'Text message is required' 
      });
    }

    const result = await telegramService.sendTextMessage(text);
    
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send video to Telegram
router.post('/send-video', async (req, res) => {
  try {
    const { videoUrl, caption } = req.body;
    
    if (!videoUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'Video URL is required' 
      });
    }

    // Fetch video from URL and convert to base64
    const fetch = require('node-fetch');
    const response = await fetch(videoUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
    }
    
    const videoBuffer = await response.buffer();
    const videoBase64 = videoBuffer.toString('base64');
    
    // Send video using the existing method
    const result = await telegramService.sendVideoWithRetry(videoBuffer, caption || '');
    
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


module.exports = router;
