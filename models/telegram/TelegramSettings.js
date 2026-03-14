const mongoose = require('mongoose');

const telegramSettingsSchema = new mongoose.Schema({
  telegramAlertsEnabledOnRegistration: {
    type: Boolean,
    default: true
  },
  telegramAlertsEnabledOnProfileCreated: {
    type: Boolean,
    default: true
  },
  telegramAlertsEnabledOnCampaignStart: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.models.TelegramSettings || mongoose.model('TelegramSettings', telegramSettingsSchema);
