const Campaign = require('../models/campaign');
const SharedReels = require('../models/SharedReels');
const UGCSubmission = require('../models/UGCSubmission');
const UGCForm = require('../models/UGCForm');
const { getobject } = require('../utils/r2');

function formatDateTimeIST(date) {
  if (!date) return null;
  return new Date(date).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

function formatDateIST(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

async function refreshSubmissionVideoUrl(submission) {
  if (!submission?.videoKey) return submission;
  try {
    submission.videoUrl = await getobject(submission.videoKey);
  } catch {
    /* keep stored url */
  }
  return submission;
}

function buildCampaignPayload(campaign) {
  if (!campaign) return null;
  const endDate = campaign.endDate ? new Date(campaign.endDate) : null;
  const now = new Date();
  const isExpired = endDate ? endDate < now : false;

  return {
    _id: campaign._id,
    campaignName: campaign.campaignName,
    brandName: campaign.brandName,
    goal: campaign.goal,
    description: campaign.description,
    location: campaign.location,
    category: campaign.category || '',
    status: campaign.status,
    tags: campaign.tags || [],
    views: campaign.views,
    credits: campaign.credits,
    cutoff: campaign.cutoff,
    limit: campaign.limit,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    expiresAt: campaign.endDate,
    expiresAtFormatted: formatDateTimeIST(campaign.endDate),
    expiresOn: formatDateIST(campaign.endDate),
    isExpired,
    daysRemaining: endDate && !isExpired
      ? Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)))
      : 0,
    image: campaign.image || null,
    categoryImage: campaign.categoryImage || null,
    brandImage: campaign.brandImage || null,
    tNc: campaign.tNc || '',
  };
}

function findUserAssignment(sharedDoc, campaignId, campaignTaskId = null) {
  if (!sharedDoc?.reels?.length) return null;
  let reels = sharedDoc.reels.filter((r) => String(r.campaignId) === String(campaignId));
  if (!reels.length) return null;

  // If campaignTaskId provided, find that specific task
  if (campaignTaskId) {
    const specific = reels.find((r) => String(r.campaignTaskId) === String(campaignTaskId));
    if (specific) reels = [specific];
  }

  // Pick the most recent active (non-rejected) task, fallback to earliest
  const active = reels.filter((r) => r.TaskStatus !== 'rejected');
  const target = active.length
    ? active.reduce((a, b) => new Date(a.createdAt) >= new Date(b.createdAt) ? a : b)
    : reels.reduce((a, b) => new Date(a.createdAt) <= new Date(b.createdAt) ? a : b);

  return {
    assignedAt: target.createdAt,
    assignedAtFormatted: formatDateTimeIST(target.createdAt),
    assignedOn: formatDateIST(target.createdAt),
    taskStatus: target.TaskStatus || 'assigned',
    isTaskComplete: !!target.isTaskComplete,
    isTaskAccepted: !!target.isTaskAccepted,
    credits: target.credits ?? null,
    reelId: target.reelId,
    campaignTaskId: target.campaignTaskId || '',
    title: target.title || '',
    taskCode: target.taskCode || '',
  };
}

function buildSubmissionPayload(submission) {
  if (!submission) return null;
  return {
    ...submission,
    submittedAt: submission.createdAt,
    submittedAtFormatted: formatDateTimeIST(submission.createdAt),
    submittedOn: formatDateIST(submission.createdAt),
    filledAt: submission.createdAt,
    filledAtFormatted: formatDateTimeIST(submission.createdAt),
    filledOn: formatDateIST(submission.createdAt),
    lastUpdatedAt: submission.updatedAt,
    lastUpdatedAtFormatted: formatDateTimeIST(submission.updatedAt),
    statusLabel:
      submission.status === 'approved'
        ? 'Approved'
        : submission.status === 'rejected'
          ? 'Rejected — re-upload allowed'
          : 'Under review',
  };
}

/**
 * Full UGC context for mobile: form + campaign + assignment + submission + credits.
 */
async function buildUGCFormResponse(campaignId, userId = null, campaignTaskId = null) {
  const [form, campaign] = await Promise.all([
    UGCForm.findOne({ campaignId: String(campaignId) }).lean(),
    Campaign.findById(campaignId).lean(),
  ]);

  let assignment = null;
  let submission = null;

  if (userId) {
    const sharedDoc = await SharedReels.findOne({ googleId: String(userId) }).lean();
    assignment = findUserAssignment(sharedDoc, campaignId, campaignTaskId);

    // Resolve campaignTaskId from assignment if not passed directly
    const resolvedTaskId = campaignTaskId || assignment?.campaignTaskId;

    if (resolvedTaskId) {
      // Scope submission to specific task assignment
      const subDoc = await UGCSubmission.findOne({
        campaignTaskId: String(resolvedTaskId),
        userId: String(userId),
      }).lean();
      if (subDoc) submission = await refreshSubmissionVideoUrl({ ...subDoc });
    } else {
      // Fallback: get latest non-rejected submission for this campaign
      const subDoc = await UGCSubmission.findOne({
        campaignId: String(campaignId),
        userId: String(userId),
        status: { $ne: 'rejected' },
      }).sort({ createdAt: -1 }).lean();
      if (subDoc) submission = await refreshSubmissionVideoUrl({ ...subDoc });
    }
  }

  const campaignDetails = buildCampaignPayload(campaign);
  const creditsOnCompletion =
    assignment?.credits ?? campaignDetails?.credits ?? null;

  return {
    form: form || null,
    campaign: campaignDetails,
    assignment,
    submission: buildSubmissionPayload(submission),
    creditsOnCompletion,
    expiresAt: campaignDetails?.expiresAt ?? null,
    expiresAtFormatted: campaignDetails?.expiresAtFormatted ?? null,
    isExpired: campaignDetails?.isExpired ?? false,
    assignedAt: assignment?.assignedAt ?? null,
    assignedAtFormatted: assignment?.assignedAtFormatted ?? null,
    hasSubmitted: !!submission,
    canSubmit: !!form && !campaignDetails?.isExpired,
  };
}

module.exports = {
  formatDateTimeIST,
  formatDateIST,
  buildCampaignPayload,
  buildSubmissionPayload,
  buildUGCFormResponse,
  refreshSubmissionVideoUrl,
};
