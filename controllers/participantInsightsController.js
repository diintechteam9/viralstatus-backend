const mongoose = require('mongoose');
const User = require('../models/user');
const MobileUser = require('../models/MobileUser');
const RegisteredCampaign = require('../models/RegisteredCampaign');
const SharedReels = require('../models/SharedReels');
const UserResponse = require('../models/userResponse');
const CreditWallet = require('../models/CreditWallet');
const Campaign = require('../models/campaign');
const { getobject } = require('../utils/r2');

async function resolveUserProfile(googleId) {
  let mobile = await MobileUser.findOne({ googleId }).select(
    '-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry -resetOtp -resetOtpExpiry'
  );
  if (!mobile && mongoose.Types.ObjectId.isValid(googleId)) {
    mobile = await MobileUser.findById(googleId).select(
      '-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry -resetOtp -resetOtpExpiry'
    );
  }
  if (mobile) {
    const u = mobile.toObject();
    return { ...u, mobileNumber: u.mobileNumber || u.mobile, googleId: u.googleId || googleId };
  }
  const webUser = await User.findOne({ googleId });
  if (webUser) {
    return {
      name: webUser.name,
      googleId: webUser.googleId,
      email: webUser.email,
    };
  }
  return null;
}

function computeCampaignActive(c) {
  if (!c) return false;
  if (c.status === 'Inactive' || c.isActive === false) return false;
  const start = new Date(c.startDate);
  const end = new Date(c.endDate);
  const now = new Date();
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return !!c.isActive;
  return start <= now && now <= end;
}

function buildActivityTimeline({ registrations, tasks, responses }) {
  const items = [];

  for (const r of registrations) {
    items.push({
      type: 'campaign_joined',
      at: r.registeredAt,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      label: `Joined campaign "${r.campaignName}"`,
    });
  }

  for (const t of tasks) {
    items.push({
      type: 'task_assigned',
      at: t.createdAt,
      campaignId: t.campaignId,
      campaignName: t.campaignName,
      reelId: t.reelId,
      label: `Task assigned: ${t.title || t.reelId}`,
      meta: { status: t.TaskStatus, credits: t.credits },
    });
    if (t.acceptedAt) {
      items.push({
        type: 'task_accepted',
        at: t.acceptedAt,
        campaignId: t.campaignId,
        campaignName: t.campaignName,
        reelId: t.reelId,
        label: `Task accepted: ${t.title || t.reelId}`,
      });
    }
    if (t.cancelledAt) {
      items.push({
        type: 'task_cancelled',
        at: t.cancelledAt,
        campaignId: t.campaignId,
        campaignName: t.campaignName,
        reelId: t.reelId,
        label: `Task cancelled${t.creditsPenalized ? ` (−${t.creditsPenalized} credits)` : ''}`,
      });
    }
  }

  for (const resp of responses) {
    items.push({
      type: resp.isTaskCompleted ? 'response_completed' : 'response_submitted',
      at: resp.createdAt || resp.updatedAt,
      campaignId: resp.campaignId,
      campaignName: resp.campaignName,
      reelId: resp.reelId,
      label: resp.isTaskCompleted
        ? `Completed submission (${resp.creditAmount || 0} credits)`
        : `Submitted URL — ${resp.status}`,
      meta: {
        views: resp.views,
        likes: resp.likes,
        comments: resp.comments,
        isCreditAccepted: resp.isCreditAccepted,
        creditAmount: resp.creditAmount,
        url: resp.urls,
      },
    });
  }

  return items
    .filter((i) => i.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

exports.getParticipantInsights = async (req, res) => {
  try {
    const { googleId } = req.params;
    const { campaignId } = req.query;

    if (!googleId) {
      return res.status(400).json({ success: false, message: 'googleId required' });
    }

    const profile = await resolveUserProfile(googleId);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const lookupId = profile.googleId || googleId;

    const [regDoc, sharedDoc, respDoc, wallet, currentCampaign] = await Promise.all([
      RegisteredCampaign.findOne({ userId: lookupId }).lean(),
      SharedReels.findOne({ googleId: lookupId }).lean(),
      UserResponse.findOne({ googleId: lookupId }).lean(),
      CreditWallet.findOne({ userId: lookupId }).lean(),
      campaignId ? Campaign.findById(campaignId).lean() : null,
    ]);

    const registeredRaw = regDoc?.registeredCampaigns || [];
    const campaignIds = registeredRaw
      .map((e) => e?.campaign?._id?.toString?.())
      .filter(Boolean);
    const freshCampaigns =
      campaignIds.length > 0
        ? await Campaign.find({ _id: { $in: campaignIds } }).lean()
        : [];
    const idToCampaign = new Map(freshCampaigns.map((c) => [c._id.toString(), c]));

    const registrations = [];
    for (const entry of registeredRaw) {
      const storedId = entry?.campaign?._id?.toString?.();
      const fresh = storedId ? idToCampaign.get(storedId) : null;
      const camp = fresh || entry.campaign;
      if (!camp) continue;
      registrations.push({
        campaignId: storedId || camp._id?.toString(),
        campaignName: camp.campaignName || camp.brandName || 'Campaign',
        brandName: camp.brandName,
        registeredAt: entry.registeredAt,
        isActive: computeCampaignActive(camp),
        credits: camp.credits,
        status: camp.status,
        startDate: camp.startDate,
        endDate: camp.endDate,
      });
    }

    const allTasks = (sharedDoc?.reels || []).map((r) => ({
      reelId: r.reelId?.toString?.() || r.reelId,
      campaignId: r.campaignId,
      campaignName: r.campaignName || '',
      title: r.title || '',
      TaskStatus: r.TaskStatus,
      isTaskAccepted: !!r.isTaskAccepted,
      isTaskComplete: !!r.isTaskComplete,
      credits: r.credits || 0,
      createdAt: r.createdAt,
      acceptedAt: r.acceptedAt,
      cancelledAt: r.cancelledAt,
      creditsPenalized: r.creditsPenalized || 0,
      penaltyApplied: !!r.penaltyApplied,
    }));

    const campaignNameMap = new Map(
      freshCampaigns.map((c) => [c._id.toString(), c.campaignName])
    );
    for (const r of registrations) {
      if (r.campaignId) campaignNameMap.set(r.campaignId, r.campaignName);
    }

    const allResponses = (respDoc?.response || []).map((r, idx) => ({
      _idx: idx,
      urls: r.urls,
      campaignId: r.campaignId,
      campaignName: campaignNameMap.get(String(r.campaignId)) || '',
      reelId: r.reelId,
      isTaskCompleted: !!r.isTaskCompleted,
      views: r.views || 0,
      likes: r.likes || 0,
      comments: r.comments || 0,
      isCreditAccepted: !!r.isCreditAccepted,
      creditAmount: r.creditAmount || 0,
      status: r.status || 'pending',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    let earnedCredits = 0;
    let pendingCredits = 0;
    let completedResponses = 0;
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;

    for (const entry of allResponses) {
      totalViews += entry.views;
      totalLikes += entry.likes;
      totalComments += entry.comments;
      if (entry.isTaskCompleted) completedResponses += 1;
      if (entry.isCreditAccepted) earnedCredits += entry.creditAmount;
      else if (entry.status === 'pending') pendingCredits += entry.creditAmount;
    }

    const stats = {
      totalCampaignsJoined: registrations.length,
      activeCampaigns: registrations.filter((r) => r.isActive).length,
      totalTasks: allTasks.length,
      completedTasks: allTasks.filter((t) => t.isTaskComplete).length,
      acceptedTasks: allTasks.filter((t) => t.isTaskAccepted).length,
      earnedCredits,
      pendingCredits,
      completedResponses,
      totalViews,
      totalLikes,
      totalComments,
      walletBalance: wallet?.totalBalance ?? 0,
      penaltiesApplied: allTasks.reduce((s, t) => s + (t.creditsPenalized || 0), 0),
    };

    const currentCampaignInsight = campaignId
      ? {
          isParticipant: !!currentCampaign?.userIds?.includes(lookupId),
          hasJoined: registrations.some((r) => String(r.campaignId) === String(campaignId)),
          registeredAt:
            registrations.find((r) => String(r.campaignId) === String(campaignId))?.registeredAt ||
            null,
          tasks: allTasks.filter((t) => String(t.campaignId) === String(campaignId)),
          responses: allResponses.filter((r) => String(r.campaignId) === String(campaignId)),
          campaignName: currentCampaign?.campaignName || '',
        }
      : null;

    const activity = buildActivityTimeline({
      registrations,
      tasks: allTasks,
      responses: allResponses,
    });

    res.json({
      success: true,
      profile,
      stats,
      registrations,
      tasks: allTasks,
      responses: allResponses,
      wallet: wallet
        ? {
            totalBalance: wallet.totalBalance,
            acceptedCredits: wallet.acceptedCredits,
            pendingCredits: wallet.pendingCredits,
            rejectedCredits: wallet.rejectedCredits,
            totalCampaigns: wallet.totalCampaigns,
          }
        : null,
      currentCampaign: currentCampaignInsight,
      activity,
    });
  } catch (err) {
    console.error('getParticipantInsights:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
