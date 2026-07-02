const SharedReels = require('../models/SharedReels');
const Campaign = require('../models/campaign');
const reelController = require('./reelcontroller');
const { getTimerStatus } = require('../utils/taskPenalty');
const { getDailyQuota, DEFAULT_DAILY_LIMIT } = require('../utils/dailyTaskLimit');
const {
  acceptUserTask,
  cancelUserTask,
  buildTimerPayload,
  findUserTaskIndex,
  normalizeReelAcceptState,
} = require('../services/userTaskService');

function findReelIndex(sharedReels, reelId, campaignId) {
  return findUserTaskIndex(sharedReels.reels, reelId, campaignId);
}

async function getCampaignOr404(campaignId, res) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) {
    res.status(404).json({ success: false, message: 'Campaign not found' });
    return null;
  }
  return campaign;
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
        const timer = buildTimerPayload(reel, campaign);
        tasks.push({
          ...reel,
          userId: doc.googleId,
          reelId: reel.reelId,
          timer,
          timerExpired: timer.timerExpired,
          penaltyZone: timer.penaltyZone,
          potentialPenalty: timer.potentialPenalty,
        });
      }
    }
    res.json({
      success: true,
      tasks,
      settings: {
        autoApproval: !!campaign.autoApproval,
        cancellationPenalty: campaign.cancellationPenalty ?? 2,
        penaltyThresholdMinutes: campaign.penaltyThresholdMinutes ?? 10,
        allowCancellation: campaign.allowCancellation !== false,
        dailyTaskAcceptLimit: campaign.dailyTaskAcceptLimit ?? 3,
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
    const shared = await SharedReels.findOne({ googleId: userId });
    if (!shared) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    const idx = findReelIndex(shared, taskId, campaignId);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    const reel = shared.reels[idx];
    const resolvedCampaignId = campaignId || reel.campaignId;
    const campaign = await Campaign.findById(resolvedCampaignId).lean();

    const timer = buildTimerPayload(reel, campaign);
    res.json({
      success: true,
      taskId,
      userId,
      campaignId: resolvedCampaignId,
      acceptedAt: reel.acceptedAt,
      isTaskAccepted: !!reel.isTaskAccepted,
      TaskStatus: reel.TaskStatus,
      timerExpired: timer.timerExpired,
      penaltyZone: timer.penaltyZone,
      potentialPenalty: timer.potentialPenalty,
      cancellationPenalty: timer.cancellationPenalty,
      penaltyThresholdMinutes: timer.penaltyThresholdMinutes,
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
      shared.reels[idx].timerExpired = false;
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
    const result = await cancelUserTask({ userId, reelId, campaignId, reason });
    return res.status(result.status).json({
      success: result.ok,
      message: result.message,
      creditsPenalized: result.creditsPenalized ?? 0,
      penaltyApplied: result.penaltyApplied ?? false,
      withinGrace: result.withinGrace,
      timerExpired: result.timerExpired ?? false,
      returned: result.returned ?? false,
      quota: result.quota,
      cancellationPenalty: result.cancellationPenalty,
      penaltyThresholdMinutes: result.penaltyThresholdMinutes,
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

/** GET /api/pools/task/daily-quota/:userId — optional query campaignId for campaign-specific limit */
exports.getDailyQuota = async (req, res) => {
  try {
    const { userId } = req.params;
    const { campaignId } = req.query;
    let limit = DEFAULT_DAILY_LIMIT;
    if (campaignId) {
      const campaign = await Campaign.findById(campaignId).select('dailyTaskAcceptLimit penaltyThresholdMinutes').lean();
      if (campaign) limit = campaign.dailyTaskAcceptLimit ?? DEFAULT_DAILY_LIMIT;
    }
    const quota = await getDailyQuota(userId, limit);
    res.json({ success: true, quota });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
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
    if (!reelIds?.length || !campaignId) {
      return res.status(400).json({
        success: false,
        message: 'reelIds and campaignId required',
      });
    }
    if (!userIds?.length) {
      const campaign = await Campaign.findById(campaignId).select('campaignType').lean();
      if (campaign?.campaignType !== 'public') {
        return res.status(400).json({
          success: false,
          message: 'userIds required for private campaigns',
        });
      }
    }
    const stratFn = assignmentStrategies[strategy] || assignmentStrategies.roundRobin;
    const plan = stratFn(userIds || [], reelIds, reelsPerUser);

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
