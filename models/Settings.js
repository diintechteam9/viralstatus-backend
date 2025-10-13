const mongoose = require('mongoose');

const TelegramSettingsSchema = new mongoose.Schema(
  {
    telegramAlertsEnabledOnRegistration: { type: Boolean, default: true },
    telegramAlertsEnabledOnProfileCreated: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TelegramSettings', TelegramSettingsSchema);


