const { syncTemplatesWithMeta } = require("../controllers/whatsapp/whatsapptemplatecontroller");

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

let intervalId = null;
let isRunning = false;

const runSync = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    await syncTemplatesWithMeta();
    console.log(
      `[WhatsAppTemplateSync] Completed at ${new Date().toISOString()}`,
    );
  } catch (error) {
    console.error(
      "[WhatsAppTemplateSync] Failed to sync templates:",
      error?.response?.data || error?.message || error,
    );
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
  console.log(
    `[WhatsAppTemplateSync] Scheduler started with interval ${intervalMs}ms`,
  );
};

const stopTemplateSyncScheduler = () => {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
  console.log("[WhatsAppTemplateSync] Scheduler stopped");
};

module.exports = {
  startTemplateSyncScheduler,
  stopTemplateSyncScheduler,
};

