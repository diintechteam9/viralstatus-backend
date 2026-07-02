/**
 * Credit penalty for task cancellation after accept.
 * @param {Date|string|null} acceptedAt
 * @param {Date|string|null} cancelledAt
 * @param {number} penaltyThresholdMinutes
 * @param {number} cancellationPenalty
 * @returns {{ credits: number, minutesElapsed: number, withinGrace: boolean }}
 */
function calculatePenalty(
  acceptedAt,
  cancelledAt,
  penaltyThresholdMinutes = 30,
  cancellationPenalty = 2
) {
  if (!acceptedAt) {
    return { credits: 0, minutesElapsed: 0, withinGrace: true };
  }
  const accepted = new Date(acceptedAt);
  const cancelled = cancelledAt ? new Date(cancelledAt) : new Date();
  const minutesElapsed = (cancelled - accepted) / (1000 * 60);
  // Grace: strictly before threshold minutes (at 10:00 min → penalty applies)
  const withinGrace = minutesElapsed < penaltyThresholdMinutes;
  return {
    credits: withinGrace ? 0 : cancellationPenalty,
    minutesElapsed: Math.max(0, minutesElapsed),
    withinGrace,
  };
}

function getTimerStatus(acceptedAt, penaltyThresholdMinutes = 30) {
  if (!acceptedAt) {
    return {
      phase: 'not_accepted',
      safeToCancel: true,
      remainingMs: null,
      timerExpired: false,
      penaltyThresholdMinutes,
    };
  }
  const accepted = new Date(acceptedAt);
  const thresholdMs = penaltyThresholdMinutes * 60 * 1000;
  const elapsed = Date.now() - accepted.getTime();
  const remainingMs = Math.max(0, thresholdMs - elapsed);
  const timerExpired = remainingMs <= 0;
  return {
    phase: timerExpired ? 'penalty_zone' : 'grace_period',
    safeToCancel: !timerExpired,
    remainingMs,
    timerExpired,
    penaltyThresholdMinutes,
  };
}

module.exports = { calculatePenalty, getTimerStatus };
