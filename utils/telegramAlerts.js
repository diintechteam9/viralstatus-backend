const { Telegraf } = require('telegraf');
const TelegramSettings = require('../models/telegram/TelegramSettings');
const { getBotToken, getChatId, getConfigStatus } = require('./telegramConfig');

/** Alert on unless explicitly disabled in DB */
const isAlertEnabled = (settings, key) => settings[key] !== false;

const esc = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const fmtTime = () =>
  new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

const getBot = () => {
  const token = getBotToken();
  if (!token) return null;
  return new Telegraf(token);
};

const send = async (message) => {
  const chatId = getChatId();
  const token = getBotToken();

  if (!chatId || !token) {
    console.warn(
      '[TelegramAlert] Skipped — missing env. Need TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (or TELEGRAMBOT_API_KEY + CHATID)'
    );
    return { success: false, skipped: true, reason: 'not_configured' };
  }

  try {
    const bot = getBot();
    await bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
    return { success: true };
  } catch (err) {
    console.error('[TelegramAlert] Failed to send:', err.message);
    if (err.response?.description) {
      console.error('[TelegramAlert] Telegram API:', err.response.description);
    }
    return { success: false, error: err.message };
  }
};

const getSettings = async () => {
  try {
    let s = await TelegramSettings.findOne();
    if (!s) s = await TelegramSettings.create({});
    return s;
  } catch (err) {
    console.error('[TelegramAlert] Settings load failed:', err.message);
    return {};
  }
};

const alertCampaignCreate = async ({ campaignName, clientName, credits, cutoff }) => {
  const s = await getSettings();
  if (!isAlertEnabled(s, 'telegramAlertsEnabledOnCampaignCreate')) return;
  return send(
    `🚀 <b>New Campaign Created</b>\n\n` +
      `📋 <b>Campaign:</b> ${campaignName}\n` +
      `👤 <b>Client:</b> ${clientName || 'N/A'}\n` +
      `💰 <b>Credits:</b> ${credits || 0}\n` +
      `🎯 <b>Cutoff Views:</b> ${cutoff || 0}\n` +
      `🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
  );
};

const alertCampaignStart = async ({ campaignName, clientName, totalUsers }) => {
  const s = await getSettings();
  if (!isAlertEnabled(s, 'telegramAlertsEnabledOnCampaignStart')) return;
  return send(
    `✅ <b>Campaign Started</b>\n\n` +
      `📋 <b>Campaign:</b> ${campaignName}\n` +
      `👤 <b>Client:</b> ${clientName || 'N/A'}\n` +
      `👥 <b>Users Assigned:</b> ${totalUsers || 0}\n` +
      `🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
  );
};

/** User registered / joined a campaign (mobile app) */
const alertUserJoin = async ({
  userName,
  email,
  mobile,
  city,
  campaignName,
  brandName,
  registeredAt,
  platform,
}) => {
  const s = await getSettings();
  if (!isAlertEnabled(s, 'telegramAlertsEnabledOnUserJoin')) return;
  return send(
    `🎉 <b>Campaign Registration</b>\n\n` +
      `👤 <b>Name:</b> ${esc(userName || 'N/A')}\n` +
      `📧 <b>Email:</b> ${esc(email || 'N/A')}\n` +
      `📱 <b>Mobile:</b> ${esc(mobile || 'N/A')}\n` +
      `📍 <b>City:</b> ${esc(city || 'N/A')}\n` +
      `📋 <b>Campaign:</b> ${esc(campaignName || 'N/A')}\n` +
      (brandName ? `🏷️ <b>Brand:</b> ${esc(brandName)}\n` : '') +
      (registeredAt
        ? `📅 <b>Joined:</b> ${esc(new Date(registeredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}\n`
        : '') +
      `📲 <b>Source:</b> ${esc(platform || 'YOHO App')}\n` +
      `🕐 <b>Alert time:</b> ${fmtTime()}`
  );
};

/** Admin assigned tasks/reels to participants */
const alertTasksAssigned = async ({
  campaign,
  assignments,
  reelsPerUser,
  autoApproval,
}) => {
  const s = await getSettings();
  if (!isAlertEnabled(s, 'telegramAlertsEnabledOnUserJoin')) return;

  const rows = (assignments || []).filter((a) => (a.reels?.length || a.assignedReels?.length || 0) > 0);
  if (rows.length === 0) return;

  const participantLines = rows
    .map((a, i) => {
      const p = a.profile || {};
      const reelCount = a.reels?.length ?? a.assignedReels?.length ?? reelsPerUser ?? 0;
      const titles = (a.reels || [])
        .map((r) => r.title)
        .filter(Boolean)
        .slice(0, 3)
        .join(', ');
      return (
        `<b>${i + 1}. ${esc(p.name || 'Unknown')}</b>\n` +
        `   📧 ${esc(p.email || 'N/A')}\n` +
        `   📱 ${esc(p.mobile || 'N/A')}\n` +
        `   📍 ${esc(p.city || 'N/A')}\n` +
        `   🎬 <b>${reelCount}</b> reel(s)${titles ? ` — ${esc(titles)}` : ''}`
      );
    })
    .join('\n\n');

  const totalReels = rows.reduce(
    (sum, a) => sum + (a.reels?.length ?? a.assignedReels?.length ?? 0),
    0
  );

  return send(
    `📋 <b>Tasks Assigned to Participants</b>\n\n` +
      `📌 <b>Campaign:</b> ${esc(campaign?.campaignName || 'N/A')}\n` +
      `🏷️ <b>Brand:</b> ${esc(campaign?.brandName || 'N/A')}\n` +
      `👥 <b>Participants:</b> ${rows.length}\n` +
      `🎬 <b>Total reels assigned:</b> ${totalReels}\n` +
      `📊 <b>Reels per user:</b> ${reelsPerUser ?? '—'}\n` +
      `💰 <b>Credits per task:</b> ${campaign?.credits ?? 0}\n` +
      `✅ <b>Auto-approval:</b> ${autoApproval ? 'ON' : 'OFF'}\n` +
      `━━━━━━━━━━━━━━━━\n\n` +
      `${participantLines}\n\n` +
      `🕐 ${fmtTime()}`
  );
};

const alertUserEarn = async ({
  userName,
  email,
  mobile,
  credits,
  campaignName,
  videoUrl,
  note,
}) => {
  const s = await getSettings();
  if (!isAlertEnabled(s, 'telegramAlertsEnabledOnUserEarn')) return;
  return send(
    `📤 <b>New Task Submission</b>\n\n` +
      `👤 <b>Name:</b> ${esc(userName || 'N/A')}\n` +
      (email ? `📧 <b>Email:</b> ${esc(email)}\n` : '') +
      (mobile ? `📱 <b>Mobile:</b> ${esc(mobile)}\n` : '') +
      `📋 <b>Campaign:</b> ${esc(campaignName || 'N/A')}\n` +
      `💰 <b>Campaign credits:</b> ${credits || 0}\n` +
      `🔗 <b>Video:</b> ${videoUrl ? `<a href="${esc(videoUrl)}">Open link</a>` : 'N/A'}\n` +
      (note ? `📝 ${esc(note)}\n` : '') +
      `🕐 ${fmtTime()}`
  );
};

const alertRegistration = async ({ userName, email, role }) => {
  const s = await getSettings();
  if (!isAlertEnabled(s, 'telegramAlertsEnabledOnRegistration')) return;
  return send(
    `📝 <b>New Registration</b>\n\n` +
      `👤 <b>Name:</b> ${userName || 'N/A'}\n` +
      `📧 <b>Email:</b> ${email || 'N/A'}\n` +
      `🏷️ <b>Role:</b> ${role || 'user'}\n` +
      `🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
  );
};

const alertProfileCreated = async ({ userName, email }) => {
  const s = await getSettings();
  if (!isAlertEnabled(s, 'telegramAlertsEnabledOnProfileCreated')) return;
  return send(
    `✨ <b>Profile Created</b>\n\n` +
      `👤 <b>Name:</b> ${userName || 'N/A'}\n` +
      `📧 <b>Email:</b> ${email || 'N/A'}\n` +
      `🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
  );
};

const alertReelUpload = async ({ poolName, reelCount, clientName }) => {
  const s = await getSettings();
  if (!isAlertEnabled(s, 'telegramAlertsEnabledOnReelUpload')) return;
  return send(
    `🎬 <b>Reels Uploaded</b>\n\n` +
      `🗂️ <b>Pool:</b> ${poolName || 'N/A'}\n` +
      `📊 <b>Count:</b> ${reelCount || 0} reels\n` +
      `👤 <b>Client:</b> ${clientName || 'N/A'}\n` +
      `🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
  );
};

const alertPoolCreate = async ({ poolName, clientName }) => {
  const s = await getSettings();
  if (!isAlertEnabled(s, 'telegramAlertsEnabledOnPoolCreate')) return;
  return send(
    `🗂️ <b>New Pool Created</b>\n\n` +
      `📁 <b>Pool:</b> ${poolName || 'N/A'}\n` +
      `👤 <b>Client:</b> ${clientName || 'N/A'}\n` +
      `🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
  );
};

const alertClientLogin = async ({ clientName, email }) => {
  const s = await getSettings();
  if (!isAlertEnabled(s, 'telegramAlertsEnabledOnClientLogin')) return;
  return send(
    `🔐 <b>Client Logged In</b>\n\n` +
      `👤 <b>Name:</b> ${clientName || 'N/A'}\n` +
      `📧 <b>Email:</b> ${email || 'N/A'}\n` +
      `🕐 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
  );
};

const sendTestAlert = async () => {
  const status = getConfigStatus();
  if (!status.configured) {
    return {
      success: false,
      message: 'Telegram not configured in .env',
      status,
    };
  }
  const result = await send(
    `🧪 <b>YOHO AI — Test Alert</b>\n\n` +
      `Telegram integration is working.\n` +
      `🕐 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
  );
  return { ...result, status };
};

module.exports = {
  alertCampaignCreate,
  alertCampaignStart,
  alertUserJoin,
  alertTasksAssigned,
  alertUserEarn,
  alertRegistration,
  alertProfileCreated,
  alertReelUpload,
  alertPoolCreate,
  alertClientLogin,
  sendTestAlert,
  getConfigStatus,
};
