const express = require('express');
const router = express.Router();
const TelegramSettings = require('../../models/telegram/TelegramSettings');
const { getConfigStatus } = require('../../utils/telegramConfig');
const { sendTestAlert } = require('../../utils/telegramAlerts');

// Env + connection status (no secrets exposed)
router.get('/alert-status', async (req, res) => {
  try {
    res.json({ success: true, ...getConfigStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send test message to configured chat
router.post('/test-alert', async (req, res) => {
  try {
    const result = await sendTestAlert();
    if (result.success) {
      return res.json({ success: true, message: 'Test alert sent to Telegram' });
    }
    return res.status(400).json({
      success: false,
      message: result.message || result.error || 'Failed to send test alert',
      status: result.status,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
