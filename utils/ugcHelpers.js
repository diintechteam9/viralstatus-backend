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

function findUserAssignment(sharedDoc, campaignId) {
  if (!sharedDoc?.reels?.length) return null;
  const reels = sharedDoc.reels.filter((r) => String(r.campaignId) === String(campaignId));
  if (!reels.length) return null;

  const earliest = reels.reduce((a, b) =>
    new Date(a.createdAt) <= new Date(b.createdAt) ? a : b
  );

  return {
    assignedAt: earliest.createdAt,
    assignedAtFormatted: formatDateTimeIST(earliest.createdAt),
    assignedOn: formatDateIST(earliest.createdAt),
    taskStatus: earliest.TaskStatus || 'assigned',
    isTaskComplete: !!earliest.isTaskComplete,
    isTaskAccepted: !!earliest.isTaskAccepted,
    credits: earliest.credits ?? null,
    reelId: earliest.reelId,
    title: earliest.title || '',
    taskCode: earliest.taskCode || '',
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
async function buildUGCFormResponse(campaignId, userId = null) {
  const [form, campaign] = await Promise.all([
    UGCForm.findOne({ campaignId: String(campaignId) }).lean(),
    Campaign.findById(campaignId).lean(),
  ]);

  let assignment = null;
  let submission = null;

  if (userId) {
    const [sharedDoc, subDoc] = await Promise.all([
      SharedReels.findOne({ googleId: String(userId) }).lean(),
      UGCSubmission.findOne({ campaignId: String(campaignId), userId: String(userId) }).lean(),
    ]);
    assignment = findUserAssignment(sharedDoc, campaignId);
    if (subDoc) {
      submission = await refreshSubmissionVideoUrl({ ...subDoc });
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
