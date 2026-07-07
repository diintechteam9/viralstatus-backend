const SharedReels = require('../models/SharedReels');
const Campaign = require('../models/campaign');
const CreditWallet = require('../models/CreditWallet');
const TransactionHistory = require('../models/TransactionHistory');
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

async function applyCreditPenalty(userId, amount, meta = {}) {
  if (!amount || amount <= 0) return;

  const wallet = await CreditWallet.findOneAndUpdate(
    { userId },
    { $inc: { totalBalance: -amount } },
    { new: true, upsert: true }
  );
  const balanceAfter = Math.max(0, wallet.totalBalance);

  // Sync wallet if it went below 0
  if (wallet.totalBalance < 0) {
    await CreditWallet.updateOne({ userId }, { $set: { totalBalance: 0 } });
  }

  await TransactionHistory.create({
    userId,
    type: 'penalty',
    amount: -amount,
    description: meta.description || 'Task cancellation penalty',
    referenceType: 'task',
    referenceId: meta.taskId || '',
    status: 'completed',
    meta: {
      campaignId: meta.campaignId || '',
      taskId: meta.taskId || '',
      reason: meta.reason || 'Task cancelled after penalty threshold',
    },
    balanceAfter,
  });
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
  reel.cancelledAt = null;
  reel.cancellationReason = '';
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
    await applyCreditPenalty(userId, penaltyResult.creditsPenalized, {
      campaignId: resolvedCampaignId,
      taskId: reel.reelId || reelId,
      reason: 'Task cancelled after penalty threshold exceeded',
      description: `Penalty for cancelling task: ${reel.title || reelId}`,
    });
  }

  await releaseAcceptSlot(userId, reel.reelId || reelId, resolvedCampaignId);

  const newCancelCount = (shared.reels[idx].cancelCount || 0) + 1;
  const isThirdCancel = newCancelCount >= 3;

  // Force penalty on 3rd+ cancel even if within grace period
  let finalPenaltyResult = penaltyResult;
  if (isThirdCancel && !penaltyResult.penaltyApplied) {
    const forcedCredits = penaltyResult.cancellationPenalty || 2;
    await applyCreditPenalty(userId, forcedCredits, {
      campaignId: resolvedCampaignId,
      taskId: reel.reelId || reelId,
      reason: 'Task cancelled 3 or more times',
      description: `Penalty for cancelling task 3+ times: ${reel.title || reelId}`,
    });
    finalPenaltyResult = {
      ...penaltyResult,
      creditsPenalized: forcedCredits,
      penaltyApplied: true,
    };
  }

  const taskSubdocId = shared.reels[idx]._id;

  if (finalPenaltyResult.penaltyApplied) {
    // Penalty applied — remove task from user's list entirely
    await SharedReels.updateOne(
      { googleId: userId },
      { $pull: { reels: { _id: taskSubdocId } } }
    );
  } else {
    // No penalty — reset task back to assigned so user can re-accept
    shared.reels[idx].TaskStatus = 'assigned';
    shared.reels[idx].isTaskAccepted = false;
    shared.reels[idx].isTaskComplete = false;
    shared.reels[idx].cancelledAt = null;
    shared.reels[idx].cancellationReason = '';
    shared.reels[idx].penaltyApplied = false;
    shared.reels[idx].creditsPenalized = 0;
    shared.reels[idx].cancelCount = newCancelCount;
    shared.reels[idx].acceptedAt = null;
    shared.reels[idx].inProgressAt = null;
    shared.reels[idx].submissionStatus = 'none';
    await shared.save();
  }

  const quota = await getDailyQuota(userId, finalPenaltyResult.dailyTaskAcceptLimit ?? DEFAULT_DAILY_LIMIT);

  const warningMessage = isThirdCancel
    ? `Warning: You have cancelled this task 3 times. ${finalPenaltyResult.creditsPenalized} credit(s) have been deducted as penalty and the task has been removed.`
    : null;

  return {
    ok: true,
    status: 200,
    message: finalPenaltyResult.penaltyApplied
      ? `Task cancelled. ${finalPenaltyResult.creditsPenalized} credit(s) deducted as penalty. Task removed from your list.`
      : 'Task cancelled with no penalty. Task returned to pool.',
    warning: warningMessage,
    cancelCount: newCancelCount,
    taskRemoved: finalPenaltyResult.penaltyApplied,
    creditsPenalized: finalPenaltyResult.creditsPenalized,
    penaltyApplied: finalPenaltyResult.penaltyApplied,
    withinGrace: finalPenaltyResult.withinGrace,
    timerExpired: finalPenaltyResult.penaltyApplied,
    returned: !finalPenaltyResult.penaltyApplied,
    quota,
    cancellationPenalty: finalPenaltyResult.cancellationPenalty,
    penaltyThresholdMinutes: finalPenaltyResult.penaltyThresholdMinutes,
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
