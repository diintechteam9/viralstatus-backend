const { syncTemplatesWithMeta } = require("../controllers/whatsapp/whatsapptemplatecontroller");

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let intervalId = null;
let isRunning = false;

const runSync = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    await syncTemplatesWithMeta();
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error(
        "[WhatsApp] Template sync failed:",
        error?.message || error,
      );
    }
  } finally {
    isRunning = false;
  }
};

const startTemplateSyncScheduler = () => {
  if (intervalId) return;
  const intervalMs =
    Number(process.env.WHATSAPP_TEMPLATE_SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  // Run immediately on startup
  runSync();

  intervalId = setInterval(runSync, intervalMs);
  console.log(`✅ WhatsApp template sync started (${intervalMs / 60000} min interval)`);
};

const stopTemplateSyncScheduler = () => {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
};

module.exports = {
  startTemplateSyncScheduler,
  stopTemplateSyncScheduler,
};

