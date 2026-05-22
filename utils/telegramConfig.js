/**
 * Telegram bot config — supports multiple .env naming conventions.
 *
 * Preferred (new):
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *
 * Legacy:
 *   TELEGRAMBOT_API_KEY
 *   CHATID
 */

function getBotToken() {
  return (
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAMBOT_API_KEY ||
    ''
  ).trim();
}

function getChatId() {
  const id = process.env.TELEGRAM_CHAT_ID || process.env.CHATID || '';
  return String(id).trim();
}

function getConfigStatus() {
  const token = getBotToken();
  const chatId = getChatId();
  return {
    configured: Boolean(token && chatId),
    tokenSet: Boolean(token),
    chatIdSet: Boolean(chatId),
    tokenSource: process.env.TELEGRAM_BOT_TOKEN
      ? 'TELEGRAM_BOT_TOKEN'
      : process.env.TELEGRAMBOT_API_KEY
        ? 'TELEGRAMBOT_API_KEY'
        : null,
    chatIdSource: process.env.TELEGRAM_CHAT_ID
      ? 'TELEGRAM_CHAT_ID'
      : process.env.CHATID
        ? 'CHATID'
        : null,
  };
}

function logConfigOnStartup() {
  const s = getConfigStatus();
  if (s.configured) {
    console.log(
      `✅ Telegram alerts: configured (token: ${s.tokenSource}, chat: ${s.chatIdSource})`
    );
  } else {
    console.warn(
      '⚠️  Telegram alerts: NOT configured — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (or TELEGRAMBOT_API_KEY + CHATID) in .env'
    );
    if (s.tokenSet && !s.chatIdSet) console.warn('   Missing chat id: TELEGRAM_CHAT_ID or CHATID');
    if (!s.tokenSet && s.chatIdSet) console.warn('   Missing bot token: TELEGRAM_BOT_TOKEN or TELEGRAMBOT_API_KEY');
  }
}

module.exports = {
  getBotToken,
  getChatId,
  getConfigStatus,
  logConfigOnStartup,
};
