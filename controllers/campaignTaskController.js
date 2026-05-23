const CampaignTask = require('../models/CampaignTask');
const Campaign    = require('../models/campaign');

// POST /api/campaign-tasks
exports.createTask = async (req, res) => {
  try {
    const {
      campaignId, clientId, title, description,
      platform, taskType, targetUrl, targetCount,
      credits, proofRequired, status, deadline, order,
    } = req.body;

    if (!campaignId || !title || !platform || !taskType || credits === undefined) {
      return res.status(400).json({ success: false, message: 'campaignId, title, platform, taskType, credits are required' });
    }

    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const task = await CampaignTask.create({
      campaignId,
      clientId: clientId || campaign.clientId,
      title, description, platform, taskType,
      targetUrl, targetCount, credits,
      proofRequired, status, deadline, order,
    });

    res.status(201).json({ success: true, task });
  } catch (err) {
    console.error('createTask:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/campaign-tasks/:campaignId
exports.getTasksByCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const tasks = await CampaignTask.find({ campaignId }).sort({ order: 1, createdAt: -1 }).lean();
    res.json({ success: true, tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/campaign-tasks/task/:taskId
exports.updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const allowed = ['title','description','platform','taskType','targetUrl','targetCount','credits','proofRequired','status','deadline','order'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const task = await CampaignTask.findByIdAndUpdate(taskId, update, { new: true });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/campaign-tasks/task/:taskId
exports.deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await CampaignTask.findByIdAndDelete(taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/campaign-tasks/task/:taskId/status
exports.updateTaskStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;
    const valid = ['active', 'paused', 'completed', 'draft'];
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    const task = await CampaignTask.findByIdAndUpdate(taskId, { status }, { new: true });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/campaign-tasks/task/:taskId/assign
exports.assignTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { userIds, reelId, reelS3Url, reelS3Key, reelTitle } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0)
      return res.status(400).json({ success: false, message: 'userIds array is required' });

    const CampaignTask = require('../models/CampaignTask');
    const SharedReels  = require('../models/SharedReels');

    const task = await CampaignTask.findByIdAndUpdate(
      taskId,
      { $addToSet: { assignedTo: { $each: userIds } } },
      { new: true }
    );
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const now = new Date();
    for (const googleId of userIds) {
      const existing = await SharedReels.findOne({ googleId, 'reels.reelId': taskId });
      if (existing) continue;

      await SharedReels.findOneAndUpdate(
        { googleId },
        {
          $push: {
            reels: {
              reelId: taskId,
              s3Key: reelS3Key || '',
              s3Url: reelS3Url || '',
              campaignId: task.campaignId,
              campaignName: task.title,
              credits: task.credits,
              title: reelTitle || task.title,
              campaignImageKey: '',
              isTaskComplete: false,
              isTaskAccepted: true,
              TaskStatus: 'accepted',
              acceptedAt: now,
              createdAt: now,
            },
          },
        },
        { upsert: true, new: true }
      );
    }

    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/campaign-tasks/:campaignId/participants
exports.getCampaignParticipants = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const Campaign = require('../models/campaign');
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.json({ success: true, userIds: campaign.userIds || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
