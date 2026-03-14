const express = require('express');
const router = express.Router();
const TelegramSettings = require('../../models/telegram/TelegramSettings');

// Get settings
router.get('/settings', async (req, res) => {
  try {
    let settings = await TelegramSettings.findOne();
    if (!settings) {
      settings = await TelegramSettings.create({
        telegramAlertsEnabledOnRegistration: true,
        telegramAlertsEnabledOnProfileCreated: true,
        telegramAlertsEnabledOnCampaignStart: true
      });
    }
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error fetching Telegram settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update settings
router.put('/settings', async (req, res) => {
  try {
    const updates = req.body;
    let settings = await TelegramSettings.findOne();
    
    if (!settings) {
      settings = await TelegramSettings.create(updates);
    } else {
      Object.assign(settings, updates);
      await settings.save();
    }
    
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error updating Telegram settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
