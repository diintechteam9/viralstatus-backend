const mongoose = require('mongoose');

const telegramSettingsSchema = new mongoose.Schema({
  telegramAlertsEnabledOnRegistration: { type: Boolean, default: true },
  telegramAlertsEnabledOnProfileCreated: { type: Boolean, default: true },
  telegramAlertsEnabledOnCampaignStart: { type: Boolean, default: true },
  telegramAlertsEnabledOnCampaignCreate: { type: Boolean, default: true },
  telegramAlertsEnabledOnUserJoin: { type: Boolean, default: true },
  telegramAlertsEnabledOnUserEarn: { type: Boolean, default: true },
  telegramAlertsEnabledOnReelUpload: { type: Boolean, default: true },
  telegramAlertsEnabledOnClientLogin: { type: Boolean, default: false },
  telegramAlertsEnabledOnPoolCreate: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.models.TelegramSettings || mongoose.model('TelegramSettings', telegramSettingsSchema);
