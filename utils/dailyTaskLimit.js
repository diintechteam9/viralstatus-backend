const SharedReels = require('../models/SharedReels');

const DEFAULT_DAILY_LIMIT = 3;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function countAcceptsToday(acceptLog = []) {
  const todayStart = startOfToday();
  return (acceptLog || []).filter(
    (entry) => entry.acceptedAt && new Date(entry.acceptedAt) >= todayStart
  ).length;
}

async function getDailyQuota(userId, limit = DEFAULT_DAILY_LIMIT) {
  const shared = await SharedReels.findOne({ googleId: userId }).lean();
  const used = countAcceptsToday(shared?.acceptLog);
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    canAccept: used < limit,
  };
}

async function recordDailyAccept(userId, reelId, campaignId) {
  await SharedReels.findOneAndUpdate(
    { googleId: userId },
    {
      $push: {
        acceptLog: {
          acceptedAt: new Date(),
          reelId: String(reelId),
          campaignId: String(campaignId || ''),
        },
      },
    },
    { upsert: true }
  );
}

module.exports = {
  DEFAULT_DAILY_LIMIT,
  startOfToday,
  countAcceptsToday,
  getDailyQuota,
  recordDailyAccept,
};
