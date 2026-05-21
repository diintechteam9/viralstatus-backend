const SharedReels = require('../models/SharedReels');
const Campaign = require('../models/campaign');
const Reel = require('../models/Reel');
const CreditWallet = require('../models/CreditWallet');
const reelController = require('./reelcontroller');
const { calculatePenalty, getTimerStatus } = require('../utils/taskPenalty');

function findReelIndex(sharedReels, reelId, campaignId) {
  return sharedReels.reels.findIndex(
    (reel) =>
      (reel.reelId?.toString() === String(reelId) || reel._id?.toString() === String(reelId)) &&
      (!campaignId || String(reel.campaignId) === String(campaignId))
  );
}

async function getCampaignOr404(campaignId, res) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) {
    res.status(404).json({ success: false, message: 'Campaign not found' });
    return null;
  }
  return campaign;
}

async function applyCreditPenalty(userId, amount) {
  if (!amount || amount <= 0) return;
  let wallet = await CreditWallet.findOne({ userId });
  if (!wallet) {
    wallet = new CreditWallet({ userId, totalBalance: 0 });
  }
  wallet.totalBalance = Math.max(0, (wallet.totalBalance || 0) - amount);
  await wallet.save();
}

/** GET /api/pools/task/campaign/:campaignId */
exports.getCampaignTasks = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = await getCampaignOr404(campaignId, res);
    if (!campaign) return;

    const docs = await SharedReels.find({ 'reels.campaignId': String(campaignId) }).lean();
    const tasks = [];
    for (const doc of docs) {
      for (const reel of doc.reels || []) {
        if (String(reel.campaignId) !== String(campaignId)) continue;
        const timer = getTimerStatus(
          reel.acceptedAt,
          campaign.penaltyThresholdMinutes ?? 30
        );
        tasks.push({
          ...reel,
          userId: doc.googleId,
          reelId: reel.reelId,
          timer,
        });
      }
    }
    res.json({
      success: true,
      tasks,
      settings: {
        autoApproval: !!campaign.autoApproval,
        cancellationPenalty: campaign.cancellationPenalty ?? 2,
        penaltyThresholdMinutes: campaign.penaltyThresholdMinutes ?? 30,
        allowCancellation: campaign.allowCancellation !== false,
      },
    });
  } catch (err) {
    console.error('getCampaignTasks:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /api/pools/task/timer-status/:taskId — taskId = reelId, query: userId, campaignId */
exports.getTaskTimerStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { userId, campaignId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId query required' });
    }
    const campaign = campaignId
      ? await Campaign.findById(campaignId)
      : null;
    const shared = await SharedReels.findOne({ googleId: userId });
    if (!shared) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    const idx = findReelIndex(shared, taskId, campaignId);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    const reel = shared.reels[idx];
    const threshold = campaign?.penaltyThresholdMinutes ?? 30;
    const timer = getTimerStatus(reel.acceptedAt, threshold);
    res.json({
      success: true,
      taskId,
      userId,
      acceptedAt: reel.acceptedAt,
      timerExpired: reel.timerExpired || timer.timerExpired,
      ...timer,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** POST /api/pools/task/bulk-accept */
exports.bulkAcceptTasks = async (req, res) => {
  try {
    const { tasks, campaignId } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ success: false, message: 'tasks array required' });
    }
    const results = [];
    for (const { userId, reelId } of tasks) {
      const shared = await SharedReels.findOne({ googleId: userId });
      if (!shared) {
        results.push({ userId, reelId, success: false, message: 'Not found' });
        continue;
      }
      const idx = findReelIndex(shared, reelId, campaignId);
      if (idx === -1) {
        results.push({ userId, reelId, success: false, message: 'Task not found' });
        continue;
      }
      shared.reels[idx].TaskStatus = 'accepted';
      shared.reels[idx].isTaskAccepted = true;
      shared.reels[idx].acceptedAt = shared.reels[idx].acceptedAt || new Date();
      await shared.save();
      results.push({ userId, reelId, success: true });
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** POST /api/pools/task/bulk-reject */
exports.bulkRejectTasks = async (req, res) => {
  try {
    const { tasks, campaignId } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ success: false, message: 'tasks array required' });
    }
    const results = [];
    for (const { userId, reelId } of tasks) {
      const shared = await SharedReels.findOne({ googleId: userId });
      if (!shared) {
        results.push({ userId, reelId, success: false, message: 'Not found' });
        continue;
      }
      const idx = findReelIndex(shared, reelId, campaignId);
      if (idx === -1) {
        results.push({ userId, reelId, success: false, message: 'Task not found' });
        continue;
      }
      shared.reels[idx].TaskStatus = 'rejected';
      shared.reels[idx].isTaskAccepted = false;
      await shared.save();
      results.push({ userId, reelId, success: true });
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/** POST /api/pools/task/cancel */
exports.cancelTask = async (req, res) => {
  try {
    const { userId, reelId, campaignId, reason } = req.body;
    if (!userId || !reelId || !campaignId) {
      return res.status(400).json({
        success: false,
        message: 'userId, reelId, campaignId required',
      });
    }
    const campaign = await getCampaignOr404(campaignId, res);
    if (!campaign) return;
    if (campaign.allowCancellation === false) {
      return res.status(403).json({
        success: false,
        message: 'Cancellation is disabled for this campaign',
      });
    }

    const shared = await SharedReels.findOne({ googleId: userId });
    if (!shared) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    const idx = findReelIndex(shared, reelId, campaignId);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const reel = shared.reels[idx];
    const threshold = campaign.penaltyThresholdMinutes ?? 30;
    const penaltyAmount = campaign.cancellationPenalty ?? 2;
    const cancelledAt = new Date();

    let creditsPenalized = 0;
    if (reel.isTaskAccepted && reel.acceptedAt) {
      const penalty = calculatePenalty(
        reel.acceptedAt,
        cancelledAt,
        threshold,
        penaltyAmount
      );
      creditsPenalized = penalty.credits;
      if (creditsPenalized > 0) {
        await applyCreditPenalty(userId, creditsPenalized);
      }
    }

    reel.TaskStatus = 'cancelled';
    reel.isTaskAccepted = false;
    reel.cancelledAt = cancelledAt;
    reel.cancellationReason = reason || '';
    reel.penaltyApplied = creditsPenalized > 0;
    reel.creditsPenalized = creditsPenalized;
    reel.timerExpired = creditsPenalized > 0;

    await shared.save();

    res.json({
      success: true,
      message:
        creditsPenalized > 0
          ? `Task cancelled. ${creditsPenalized} credit(s) deducted.`
          : 'Task cancelled with no penalty.',
      creditsPenalized,
      penaltyApplied: creditsPenalized > 0,
      updatedReel: reel,
    });
  } catch (err) {
    console.error('cancelTask:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const assignmentStrategies = {
  roundRobin(userIds, reelIds, reelsPerUser) {
    const assignments = [];
    let reelIdx = 0;
    const pool = [...reelIds];
    for (const userId of userIds) {
      const userReels = [];
      for (let i = 0; i < reelsPerUser && pool.length > 0; i++) {
        userReels.push(pool[reelIdx % pool.length]);
        reelIdx++;
      }
      assignments.push({ userId, reelIds: userReels });
    }
    return assignments;
  },
  random(userIds, reelIds, reelsPerUser) {
    const shuffled = [...reelIds].sort(() => Math.random() - 0.5);
    return assignmentStrategies.roundRobin(userIds, shuffled, reelsPerUser);
  },
  loadBalanced(userIds, reelIds, reelsPerUser) {
    return assignmentStrategies.roundRobin(userIds, reelIds, reelsPerUser);
  },
  skillBased(userIds, reelIds, reelsPerUser) {
    return assignmentStrategies.roundRobin(userIds, reelIds, reelsPerUser);
  },
};

/** POST /api/pools/task/bulk-assign — body: userIds, reelIds, campaignId, reelsPerUser, strategy */
exports.bulkAssignTasks = async (req, res) => {
  try {
    const {
      userIds,
      reelIds,
      campaignId,
      reelsPerUser = 1,
      strategy = 'roundRobin',
    } = req.body;
    if (!userIds?.length || !reelIds?.length || !campaignId) {
      return res.status(400).json({
        success: false,
        message: 'userIds, reelIds, campaignId required',
      });
    }
    const stratFn = assignmentStrategies[strategy] || assignmentStrategies.roundRobin;
    const plan = stratFn(userIds, reelIds, reelsPerUser);

    req.body = {
      userIds,
      reelIds,
      reelsPerUser,
      campaignId,
      distributionPlan: plan,
    };
    return reelController.assignReelsToUsersWithCount(req, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
