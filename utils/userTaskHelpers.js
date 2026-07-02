const { getTimerStatus, calculatePenalty } = require('./taskPenalty');

const DEFAULT_DAILY_LIMIT = 3;

const ACTIVE_STATUSES = new Set(['accepted', 'in_progress', 'pending']);

/**
 * Match reel by reelId, campaignTaskId, or subdocument _id.
 */
function findUserTaskIndex(reels, reelId, campaignId) {
  if (!reels?.length || reelId == null) return -1;
  const rid = String(reelId);
  return reels.findIndex((r) => {
    const matchesId =
      String(r.reelId) === rid ||
      String(r.campaignTaskId || '') === rid ||
      String(r._id) === rid;
    if (!matchesId) return false;
    if (campaignId && String(r.campaignId) !== String(campaignId)) return false;
    return true;
  });
}

/**
 * Backfill legacy Android accepts (TaskStatus=accepted without isTaskAccepted/acceptedAt).
 */
function normalizeReelAcceptState(reel) {
  if (!reel) return reel;
  const legacyAccepted =
    reel.TaskStatus === 'accepted' ||
    reel.TaskStatus === 'in_progress' ||
    reel.isTaskAccepted;

  if (legacyAccepted && !reel.isTaskAccepted) {
    reel.isTaskAccepted = true;
  }
  if (reel.isTaskAccepted && !reel.acceptedAt) {
    reel.acceptedAt = reel.createdAt || new Date();
  }
  if (reel.isTaskAccepted && reel.TaskStatus === 'assigned') {
    reel.TaskStatus = 'accepted';
  }
  return reel;
}

function isActivelyAccepted(reel) {
  if (!reel || reel.isTaskComplete) return false;
  normalizeReelAcceptState(reel);
  return (
    !!reel.isTaskAccepted &&
    reel.TaskStatus !== 'cancelled' &&
    reel.TaskStatus !== 'rejected' &&
    reel.TaskStatus !== 'completed'
  );
}

function countActiveAcceptedTasks(reels) {
  return (reels || []).filter(isActivelyAccepted).length;
}

function getCampaignTaskSettings(campaign) {
  return {
    penaltyThresholdMinutes: campaign?.penaltyThresholdMinutes ?? 10,
    cancellationPenalty: campaign?.cancellationPenalty ?? 2,
    allowCancellation: campaign?.allowCancellation !== false,
    dailyTaskAcceptLimit: campaign?.dailyTaskAcceptLimit ?? DEFAULT_DAILY_LIMIT,
  };
}

function buildTimerPayload(reel, campaign) {
  const settings = getCampaignTaskSettings(campaign);
  normalizeReelAcceptState(reel);

  if (!reel?.isTaskAccepted || !reel.acceptedAt) {
    return {
      ...settings,
      phase: 'not_accepted',
      safeToCancel: true,
      remainingMs: null,
      timerExpired: false,
      penaltyZone: false,
      minutesUntilPenalty: settings.penaltyThresholdMinutes,
    };
  }

  const timer = getTimerStatus(reel.acceptedAt, settings.penaltyThresholdMinutes);
  return {
    ...settings,
    ...timer,
    penaltyZone: timer.timerExpired,
    minutesUntilPenalty: Math.ceil((timer.remainingMs || 0) / 60000),
    potentialPenalty: timer.timerExpired ? settings.cancellationPenalty : 0,
  };
}

/**
 * Quota = concurrent active accepted tasks (cancel frees a slot).
 */
function buildDailyQuota(reels, limit = DEFAULT_DAILY_LIMIT) {
  const used = countActiveAcceptedTasks(reels);
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    canAccept: used < limit,
  };
}

function applyAcceptToReel(reel, now = new Date()) {
  normalizeReelAcceptState(reel);
  reel.TaskStatus = 'accepted';
  reel.isTaskAccepted = true;
  reel.acceptedAt = now;
  reel.timerExpired = false;
  reel.penaltyApplied = false;
  reel.creditsPenalized = 0;
  return reel;
}

function applySubmitToReel(reel) {
  if (!reel) return reel;
  normalizeReelAcceptState(reel);
  reel.TaskStatus = 'in_progress';
  reel.submissionStatus = 'pending_review';
  return reel;
}

function applyCompleteToReel(reel) {
  if (!reel) return reel;
  reel.isTaskComplete = true;
  reel.TaskStatus = 'completed';
  reel.submissionStatus = 'completed';
  return reel;
}

function applyReviewToReel(reel, approved) {
  if (!reel) return reel;
  reel.submissionStatus = approved ? 'approved' : 'rejected';
  if (approved) {
    applyCompleteToReel(reel);
  } else {
    reel.TaskStatus = 'in_progress';
  }
  return reel;
}

function computeCancelPenalty(reel, campaign, cancelledAt = new Date()) {
  normalizeReelAcceptState(reel);
  const settings = getCampaignTaskSettings(campaign);

  if (!reel.isTaskAccepted || !reel.acceptedAt) {
    return {
      creditsPenalized: 0,
      penaltyApplied: false,
      withinGrace: true,
      ...settings,
    };
  }

  const penalty = calculatePenalty(
    reel.acceptedAt,
    cancelledAt,
    settings.penaltyThresholdMinutes,
    settings.cancellationPenalty
  );

  return {
    creditsPenalized: penalty.credits,
    penaltyApplied: penalty.credits > 0,
    withinGrace: penalty.withinGrace,
    minutesElapsed: penalty.minutesElapsed,
    ...settings,
  };
}

module.exports = {
  findUserTaskIndex,
  normalizeReelAcceptState,
  isActivelyAccepted,
  countActiveAcceptedTasks,
  getCampaignTaskSettings,
  buildTimerPayload,
  buildDailyQuota,
  applyAcceptToReel,
  applySubmitToReel,
  applyCompleteToReel,
  applyReviewToReel,
  computeCancelPenalty,
  DEFAULT_DAILY_LIMIT,
};
