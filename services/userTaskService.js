const SharedReels = require('../models/SharedReels');
const Campaign = require('../models/campaign');
const CreditWallet = require('../models/CreditWallet');
const {
  findUserTaskIndex,
  normalizeReelAcceptState,
  getCampaignTaskSettings,
  buildTimerPayload,
  buildDailyQuota,
  applyAcceptToReel,
  applySubmitToReel,
  applyCompleteToReel,
  applyReviewToReel,
  computeCancelPenalty,
} = require('../utils/userTaskHelpers');
const { getDailyQuota, recordDailyAccept, releaseAcceptSlot, DEFAULT_DAILY_LIMIT } = require('../utils/dailyTaskLimit');

async function applyCreditPenalty(userId, amount) {
  if (!amount || amount <= 0) return;
  let wallet = await CreditWallet.findOne({ userId });
  if (!wallet) {
    wallet = new CreditWallet({ userId, totalBalance: 0 });
  }
  wallet.totalBalance = Math.max(0, (wallet.totalBalance || 0) - amount);
  await wallet.save();
}

async function loadCampaign(campaignId) {
  if (!campaignId) return null;
  return Campaign.findById(campaignId).lean();
}

/**
 * Unified accept — used by POST /task/accept and legacy Android routes.
 */
async function acceptUserTask({ userId, reelId, campaignId }) {
  const shared = await SharedReels.findOne({ googleId: userId });
  if (!shared) {
    return { ok: false, status: 404, message: 'User shared reels not found' };
  }

  let idx = findUserTaskIndex(shared.reels, reelId, campaignId);
  if (idx === -1) {
    idx = findUserTaskIndex(shared.reels, reelId, null);
  }
  if (idx === -1) {
    return { ok: false, status: 404, message: 'Task not found for this user' };
  }

  const reel = shared.reels[idx];
  const resolvedCampaignId = campaignId || reel.campaignId;
  const campaign = await loadCampaign(resolvedCampaignId);
  const settings = getCampaignTaskSettings(campaign);

  normalizeReelAcceptState(reel);
  if (reel.isTaskAccepted && reel.TaskStatus !== 'assigned') {
    const quota = buildDailyQuota(shared.reels, settings.dailyTaskAcceptLimit);
    return {
      ok: true,
      status: 200,
      message: 'Task already accepted',
      alreadyAccepted: true,
      updatedReel: reel,
      quota,
      ...buildTimerPayload(reel, campaign),
    };
  }

  const quotaBefore = buildDailyQuota(shared.reels, settings.dailyTaskAcceptLimit);
  if (!quotaBefore.canAccept) {
    return {
      ok: false,
      status: 429,
      message: `Daily limit reached. You can accept only ${settings.dailyTaskAcceptLimit} active task(s) at a time.`,
      quota: quotaBefore,
    };
  }

  const now = new Date();
  applyAcceptToReel(reel, now);
  await recordDailyAccept(userId, reel.reelId || reelId, resolvedCampaignId);
  await shared.save();

  const quota = buildDailyQuota(shared.reels, settings.dailyTaskAcceptLimit);
  const timer = buildTimerPayload(reel, campaign);

  return {
    ok: true,
    status: 200,
    message: 'Task accepted successfully',
    updatedReel: reel,
    quota,
    ...timer,
  };
}

/**
 * Unified cancel — penalty, slot release, task removal.
 */
async function cancelUserTask({ userId, reelId, campaignId, reason }) {
  if (!userId || reelId == null) {
    return { ok: false, status: 400, message: 'userId and reelId required' };
  }

  const shared = await SharedReels.findOne({ googleId: userId });
  if (!shared) {
    return { ok: false, status: 404, message: 'Task not found' };
  }

  let idx = findUserTaskIndex(shared.reels, reelId, campaignId);
  if (idx === -1) {
    idx = findUserTaskIndex(shared.reels, reelId, null);
  }
  if (idx === -1) {
    return { ok: false, status: 404, message: 'Task not found' };
  }

  const reel = shared.reels[idx];
  const resolvedCampaignId = campaignId || reel.campaignId;
  const campaign = await loadCampaign(resolvedCampaignId);

  if (campaign?.allowCancellation === false) {
    return { ok: false, status: 403, message: 'Cancellation is disabled for this campaign' };
  }

  const penaltyResult = computeCancelPenalty(reel, campaign);
  if (penaltyResult.creditsPenalized > 0) {
    await applyCreditPenalty(userId, penaltyResult.creditsPenalized);
  }

  await releaseAcceptSlot(userId, reel.reelId || reelId, resolvedCampaignId);
  shared.reels.splice(idx, 1);
  await shared.save();

  const quota = await getDailyQuota(userId, penaltyResult.dailyTaskAcceptLimit ?? DEFAULT_DAILY_LIMIT);

  return {
    ok: true,
    status: 200,
    message: penaltyResult.penaltyApplied
      ? `Task cancelled. ${penaltyResult.creditsPenalized} credit(s) deducted. Task returned to pool.`
      : 'Task cancelled with no penalty. Task returned to pool.',
    creditsPenalized: penaltyResult.creditsPenalized,
    penaltyApplied: penaltyResult.penaltyApplied,
    withinGrace: penaltyResult.withinGrace,
    timerExpired: penaltyResult.penaltyApplied,
    returned: true,
    quota,
    cancellationPenalty: penaltyResult.cancellationPenalty,
    penaltyThresholdMinutes: penaltyResult.penaltyThresholdMinutes,
  };
}

async function syncSharedReelSubmission(userId, reelId, campaignId, mode = 'submit') {
  const shared = await SharedReels.findOne({ googleId: userId });
  if (!shared) return null;

  let idx = findUserTaskIndex(shared.reels, reelId, campaignId);
  if (idx === -1) idx = findUserTaskIndex(shared.reels, reelId, null);
  if (idx === -1) return null;

  const reel = shared.reels[idx];
  if (mode === 'submit') {
    applySubmitToReel(reel);
  } else if (mode === 'complete') {
    applyCompleteToReel(reel);
  } else if (mode === 'approve') {
    applyReviewToReel(reel, true);
  } else if (mode === 'reject') {
    applyReviewToReel(reel, false);
  }
  await shared.save();
  return reel;
}

module.exports = {
  acceptUserTask,
  cancelUserTask,
  syncSharedReelSubmission,
  buildTimerPayload,
  findUserTaskIndex,
  normalizeReelAcceptState,
  getCampaignTaskSettings,
  buildDailyQuota,
};
