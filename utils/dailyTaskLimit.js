const SharedReels = require('../models/SharedReels');
const { buildDailyQuota, DEFAULT_DAILY_LIMIT } = require('./userTaskHelpers');

async function getDailyQuota(userId, limit = DEFAULT_DAILY_LIMIT) {
  const shared = await SharedReels.findOne({ googleId: userId }).lean();
  return buildDailyQuota(shared?.reels, limit);
}

/** Audit trail only — quota uses active accepted count, not this log */
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

async function releaseAcceptSlot(userId, reelId, campaignId) {
  const rid = String(reelId);
  const cid = String(campaignId || '');
  await SharedReels.updateOne(
    { googleId: userId },
    {
      $pull: {
        acceptLog: {
          reelId: rid,
          ...(cid ? { campaignId: cid } : {}),
        },
      },
    }
  );
}

module.exports = {
  DEFAULT_DAILY_LIMIT,
  getDailyQuota,
  recordDailyAccept,
  releaseAcceptSlot,
};
