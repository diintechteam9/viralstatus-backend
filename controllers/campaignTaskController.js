const CampaignTask = require('../models/CampaignTask');
const Campaign     = require('../models/campaign');
const SharedReels  = require('../models/SharedReels');
const UGCForm      = require('../models/UGCForm');
const TransactionHistory = require('../models/TransactionHistory');
const UserResponse = require('../models/userResponse');
const CreditWallet = require('../models/CreditWallet');
const { buildTaskTemplate } = require('../utils/campaignTaskFactory');
const { VALID_TASK_TYPE_IDS } = require('../utils/campaignTaskTypes');
const { syncSharedReelSubmission } = require('../services/userTaskService');
const multer       = require('multer');
const path         = require('path');
const fs           = require('fs');

// Multer config for proof screenshots
const proofStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/proofs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `proof-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`);
  },
});
const uploadProof = multer({ storage: proofStorage, limits: { fileSize: 10 * 1024 * 1024 } });

async function resolveTargetUserIds(campaign, userIds) {
  if (Array.isArray(userIds) && userIds.length > 0) return userIds;
  if (campaign.campaignType === 'public') {
    const MobileUser = require('../models/MobileUser');
    const allUsers = await MobileUser.find({ googleId: { $exists: true, $ne: null, $ne: '' } })
      .select('googleId').lean();
    return allUsers.map((u) => u.googleId).filter(Boolean);
  }
  return [];
}

async function assignCampaignTaskToUsers(task, userIds, assignmentScope, campaign) {
  const taskCampaignType =
    assignmentScope === 'public' || assignmentScope === 'private'
      ? assignmentScope
      : task.visibility === 'public' || campaign.campaignType === 'public'
        ? 'public'
        : 'private';

  await CampaignTask.findByIdAndUpdate(
    task._id,
    { $addToSet: { assignedTo: { $each: userIds } } },
    { new: true }
  );

  const now = new Date();
  let assignedCount = 0;
  const taskIdStr = String(task._id);

  for (const googleId of userIds) {
    const shared = await SharedReels.findOne({ googleId });
    const already = shared?.reels?.some(
      (r) =>
        String(r.campaignTaskId) === taskIdStr ||
        (String(r.campaignId) === String(task.campaignId) &&
          r.contentCategory === task.contentCategory &&
          String(r.reelId) === taskIdStr)
    );
    if (already) continue;

    await SharedReels.findOneAndUpdate(
      { googleId },
      {
        $push: {
          reels: {
            reelId: taskIdStr,
            campaignTaskId: taskIdStr,
            contentCategory: task.contentCategory || 'post',
            s3Key: '',
            s3Url: '',
            campaignId: task.campaignId,
            campaignName: campaign?.campaignName || task.title,
            credits: task.credits,
            title: task.title,
            campaignImageKey: campaign?.image?.key || '',
            description: task.description || '',
            targetUrl: task.targetUrl || '',
            targetCount: task.targetCount || 0,
            targetViews: task.targetViews || 0,
            targetLikes: task.targetLikes || 0,
            targetComments: task.targetComments || 0,
            currentViews: 0,
            currentLikes: 0,
            currentComments: 0,
            appName: task.appName || '',
            businessName: task.businessName || '',
            minRating: task.minRating || '',
            script: task.script || '',
            referenceVideoUrl: task.referenceVideoUrl || '',
            targetChannels: task.targetChannels || '',
            cutoffViews: task.cutoffViews || 0,
            isTaskComplete: false,
            isTaskAccepted: false,
            TaskStatus: 'assigned',
            acceptedAt: null,
            campaignType: taskCampaignType,
            createdAt: now,
          },
        },
      },
      { upsert: true, new: true }
    );
    assignedCount++;
  }
  return assignedCount;
}

// POST /api/campaign-tasks
exports.createTask = async (req, res) => {
  try {
    const {
      campaignId, clientId, title, description,
      platform, taskType, targetCount,
      credits, proofRequired, status, deadline, order, visibility,
      contentCategory,
      appName, businessName, minRating, script, referenceVideoUrl,
      targetViews, targetLikes, targetComments,
      targetChannels, cutoffViews,
    } = req.body;

    if (!campaignId || !title || !platform || !taskType || credits === undefined) {
      return res.status(400).json({ success: false, message: 'campaignId, title, platform, taskType, credits are required' });
    }

    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const parsedDeadline = deadline ? new Date(deadline) : null;

    const task = await CampaignTask.create({
      campaignId,
      clientId: clientId || campaign.clientId,
      title, description, platform, taskType,
      targetCount: contentCategory === 'post' ? 0 : targetCount,
      targetUrl: contentCategory === 'post' ? '' : (req.body.targetUrl || ''),
      targetViews: contentCategory === 'reels' ? (Number(targetViews) || 0) : 0,
      targetLikes: contentCategory === 'reels' ? (Number(targetLikes) || 0) : 0,
      targetComments: contentCategory === 'reels' ? (Number(targetComments) || 0) : 0,
      credits,
      proofRequired, status, deadline: parsedDeadline, order,
      visibility: visibility || 'private',
      contentCategory: contentCategory || 'post',
      appName: appName || '',
      businessName: businessName || '',
      minRating: minRating || '5',
      script: script || '',
      referenceVideoUrl: referenceVideoUrl || '',
      targetChannels: targetChannels || '',
      cutoffViews: contentCategory === 'reels' ? (Number(cutoffViews) || 0) : 0,
    });

    res.status(201).json({ success: true, task });
  } catch (err) {
    console.error('createTask:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** POST /api/campaign-tasks/:campaignId/generate — auto-create tasks for supported types */
exports.generateCampaignTasks = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const { contentCategory } = req.body;
    let types = (campaign.supportedTaskTypes || ['reels']).filter((t) => VALID_TASK_TYPE_IDS.includes(t));
    if (contentCategory && VALID_TASK_TYPE_IDS.includes(contentCategory)) {
      types = [contentCategory];
    }
    const created = [];
    const skipped = [];

    for (const category of types) {
      if (category === 'reels') {
        skipped.push({ category, reason: 'Assign reels from Content Pool below' });
        continue;
      }

      const existing = await CampaignTask.findOne({
        campaignId: String(campaignId),
        contentCategory: category,
        status: { $in: ['active', 'draft', 'paused'] },
      }).lean();

      if (existing) {
        skipped.push({ category, reason: 'Task already exists', taskId: existing._id });
        continue;
      }

      const template = buildTaskTemplate(campaign, category);
      if (!template) {
        skipped.push({ category, reason: 'Unknown category' });
        continue;
      }

      const task = await CampaignTask.create(template);
      created.push(task);

      if (category === 'ugc') {
        await UGCForm.findOneAndUpdate(
          { campaignId: String(campaignId) },
          {
            $setOnInsert: {
              title: `${campaign.campaignName} — UGC Testimonial`,
              instructions: template.description,
              script: '',
              referenceVideoUrl: '',
            },
          },
          { upsert: true, new: true }
        );
      }
    }

    res.json({
      success: true,
      message: `Generated ${created.length} task(s)`,
      created,
      skipped,
    });
  } catch (err) {
    console.error('generateCampaignTasks:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** POST /api/campaign-tasks/:campaignId/distribute — send post/ugc/review tasks to users */
exports.distributeCampaignTasks = async (req, res) => {
  try {
    const { campaignId } = req.params;
    let { userIds, assignmentScope, contentCategory } = req.body;

    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    userIds = await resolveTargetUserIds(campaign, userIds);
    if (!userIds.length) {
      return res.status(400).json({
        success: false,
        message: 'No users to assign. For private campaigns, select participants first.',
      });
    }

    const categoryList = contentCategory
      ? [contentCategory]
      : ['post', 'ugc', 'app_review', 'gmb_review'];

    const tasks = await CampaignTask.find({
      campaignId: String(campaignId),
      status: 'active',
      contentCategory: { $in: categoryList },
    }).lean();

    if (!tasks.length) {
      return res.status(400).json({
        success: false,
        message: 'No tasks to distribute. Click "Generate Tasks" first.',
      });
    }

    let totalAssigned = 0;
    const breakdown = [];

    for (const task of tasks) {
      const count = await assignCampaignTaskToUsers(task, userIds, assignmentScope, campaign);
      totalAssigned += count;
      breakdown.push({ contentCategory: task.contentCategory, title: task.title, assigned: count });
    }

    res.json({
      success: true,
      message: `Distributed ${totalAssigned} task assignment(s) to ${userIds.length} user(s)`,
      totalAssigned,
      userCount: userIds.length,
      breakdown,
    });
  } catch (err) {
    console.error('distributeCampaignTasks:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/** GET /api/campaign-tasks/task/:taskId — single task for user detail view */
exports.getTaskById = async (req, res) => {
  try {
    const { getobject } = require('../utils/r2');
    const task = await CampaignTask.findById(req.params.taskId).lean();
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const campaign = await Campaign.findById(task.campaignId).lean();
    const userId = req.query.userId;

    let liveVideoUrl = task.referenceVideoUrl || task.s3Url || '';
    if ((!liveVideoUrl || liveVideoUrl.includes('X-Amz-Expires')) && task.s3Key) {
      try { liveVideoUrl = await getobject(task.s3Key); } catch (_) {}
    }

    let campaignImageUrl = campaign?.image?.url || '';
    if (!campaignImageUrl && campaign?.image?.key) {
      try { campaignImageUrl = await getobject(campaign.image.key); } catch (_) {}
    }

    res.json({
      success: true,
      task: {
        ...task,
        referenceVideoUrl: liveVideoUrl,
        s3Url: liveVideoUrl,
        videoUrl: liveVideoUrl,
        campaignName: campaign?.campaignName || '',
        campaignImageUrl,
        brandName: campaign?.brandName || '',
        alreadyCompleted: userId ? (task.completedBy || []).includes(userId) : false,
        alreadySubmitted: userId
          ? (task.submissions || []).some((s) => s.userId === userId)
          : false,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/campaign-tasks/:campaignId
exports.getTasksByCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { getobject } = require('../utils/r2');
    const tasks = await CampaignTask.find({ campaignId }).sort({ order: 1, createdAt: -1 }).lean();

    const enrichedTasks = await Promise.all(
      tasks.map(async (t) => {
        let liveVideoUrl = t.referenceVideoUrl || t.s3Url || '';
        if ((!liveVideoUrl || liveVideoUrl.includes('X-Amz-Expires')) && t.s3Key) {
          try { liveVideoUrl = await getobject(t.s3Key); } catch (_) {}
        }
        return {
          ...t,
          referenceVideoUrl: liveVideoUrl,
          s3Url: liveVideoUrl,
          videoUrl: liveVideoUrl,
        };
      })
    );

    res.json({ success: true, tasks: enrichedTasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/campaign-tasks/public/all
exports.getPublicTasks = async (req, res) => {
  try {
    const { userId } = req.query;
    const { getobject } = require('../utils/r2');
    const { buildTimerPayload } = require('../services/userTaskService');
    const UGCSubmission = require('../models/UGCSubmission');
    const now = new Date();

    // Source 1: tasks explicitly marked visibility:public
    const explicitPublicTasks = await CampaignTask.find({ visibility: 'public', status: 'active' }).lean();
    // Source 2: tasks from public campaigns
    const publicCampaigns = await Campaign.find({
      campaignType: 'public', status: 'Active',
      $or: [{ endDate: null }, { endDate: { $gt: now } }],
    }).lean();
    const publicCampaignIds = publicCampaigns.map(c => String(c._id));
    const publicCampaignTasks = publicCampaignIds.length
      ? await CampaignTask.find({ campaignId: { $in: publicCampaignIds }, status: 'active', visibility: { $ne: 'public' } }).lean()
      : [];

    const taskMap = new Map();
    for (const t of [...explicitPublicTasks, ...publicCampaignTasks]) taskMap.set(String(t._id), t);
    const allTasks = [...taskMap.values()];
    if (!allTasks.length) return res.json({ success: true, tasks: [] });

    const campaignIds = [...new Set(allTasks.map(t => String(t.campaignId)))];
    const allCampaigns = await Campaign.find({ _id: { $in: campaignIds } }).lean();
    const campMap = new Map(allCampaigns.map(c => [String(c._id), c]));

    // User-specific data
    let userReelMap = new Map();
    let ugcSubmissionMap = new Map();
    if (userId) {
      const shared = await SharedReels.findOne({ googleId: userId }).lean();
      if (shared?.reels) {
        for (const r of shared.reels) {
          // Key by campaignTaskId first, fallback to reelId — covers all assignment paths
          const key = r.campaignTaskId || r.reelId;
          if (key) userReelMap.set(String(key), r);
        }
      }
      const taskIds = allTasks.map(t => String(t._id));
      const ugcSubs = await UGCSubmission.find({ userId: String(userId), campaignTaskId: { $in: taskIds } }).lean();
      for (const s of ugcSubs) ugcSubmissionMap.set(String(s.campaignTaskId), s);
    }

    const enriched = await Promise.all(
      allTasks
        .filter(t => {
          const camp = campMap.get(String(t.campaignId));
          if (!camp) return false;
          if (camp.endDate && new Date(camp.endDate) < now) return false;
          if (t.deadline && new Date(t.deadline) < now) return false;
          return true;
        })
        .map(async t => {
          const camp = campMap.get(String(t.campaignId)) || {};
          const taskIdStr = String(t._id);
          const userReel = userReelMap.get(taskIdStr) || null;
          const ugcSub = ugcSubmissionMap.get(taskIdStr) || null;

          let campaignImageUrl = '';
          const imgKey = camp.image?.key || '';
          if (imgKey) { try { campaignImageUrl = await getobject(imgKey); } catch (_) {} }

          let brandImageUrl = '';
          if (camp.brandImage?.key) { try { brandImageUrl = await getobject(camp.brandImage.key); } catch (_) {} }

          const timer = userReel ? buildTimerPayload(userReel, camp) : {
            timerExpired: false, penaltyZone: false, safeToCancel: true, remainingMs: 0,
            allowCancellation: true, potentialPenalty: 0,
            penaltyThresholdMinutes: camp.penaltyThresholdMinutes || 10,
            cancellationPenalty: camp.cancellationPenalty || 2,
          };

          const contentCategory = t.contentCategory || 'post';
          const taskType = (() => {
            const raw = t.taskType || contentCategory;
            if (raw === 'upload_reel' || raw === 'ugc') return 'Upload Video';
            return raw;
          })();
          const proofRequired = (() => {
            if (contentCategory === 'ugc') return 'video';
            if (['app_review', 'gmb_review'].includes(contentCategory)) return 'screenshot';
            if (['reels', 'post'].includes(contentCategory)) return 'url';
            return t.proofRequired || 'none';
          })();

          const isUnderReview = ugcSub?.status === 'pending' ||
            (t.submissions || []).some(s => s.userId === userId && s.status === 'pending');
          const alreadyCompleted = userId ? (t.completedBy || []).includes(userId) : false;
          const alreadySubmitted = userId
            ? (!!ugcSub && ugcSub.status !== 'rejected') || (t.submissions || []).some(s => s.userId === userId && s.status !== 'rejected')
            : false;

          const submission = (() => {
            if (ugcSub) return {
              _id: ugcSub._id, status: ugcSub.status,
              videoKey: ugcSub.videoKey, videoUrl: ugcSub.videoUrl,
              videoDuration: ugcSub.videoDuration, creditsEarned: ugcSub.creditsEarned,
              creditsAwarded: ugcSub.creditsAwarded,
              submittedAt: ugcSub.createdAt, updatedAt: ugcSub.updatedAt,
            };
            const sub = (t.submissions || []).find(s => s.userId === userId);
            if (sub) return {
              _id: sub._id, status: sub.status,
              proofUrl: sub.proofUrl || '', proofKey: sub.proofKey || '',
              creditsGiven: sub.creditsGiven || 0, submittedAt: sub.submittedAt,
            };
            return null;
          })();

          let reelMediaUrl = userReel?.s3Url || userReel?.referenceVideoUrl || t.referenceVideoUrl || '';
          if (!reelMediaUrl && userReel?.s3Key) {
            try { reelMediaUrl = await getobject(userReel.s3Key); } catch (_) {}
          }

          const { campaignType: _ct, assignedTo: _at, completedBy: _cb, submissions: _subs, status: _st, ...taskData } = t;
          return {
            ...taskData,
            contentCategory,
            taskType,
            proofRequired,
            instructions: t.description || '',
            referenceVideoUrl: reelMediaUrl,
            // Task Status
            TaskStatus: userReel?.TaskStatus || 'assigned',
            submissionStatus: userReel?.submissionStatus || 'none',
            isTaskAccepted: userReel ? !!userReel.isTaskAccepted : false,
            isTaskComplete: userReel ? !!userReel.isTaskComplete : false,
            alreadyCompleted,
            alreadySubmitted,
            canEdit: !!isUnderReview,
            isUnderReview: !!isUnderReview,
            isPublicTask: true,
            // Timestamps
            acceptedAt: userReel?.acceptedAt || null,
            cancelledAt: userReel?.cancelledAt || null,
            cancellationReason: userReel?.cancellationReason || '',
            // Timer & Penalty
            timerExpired: timer.timerExpired,
            penaltyZone: timer.penaltyZone,
            safeToCancel: isUnderReview ? false : timer.safeToCancel,
            remainingMs: timer.remainingMs ?? 0,
            allowCancellation: !isUnderReview && timer.allowCancellation !== false,
            penaltyApplied: userReel ? !!userReel.penaltyApplied : false,
            creditsPenalized: userReel?.creditsPenalized || 0,
            cancelCount: userReel?.cancelCount || 0,
            potentialPenalty: timer.potentialPenalty ?? 0,
            penaltyThresholdMinutes: timer.penaltyThresholdMinutes,
            cancellationPenalty: timer.cancellationPenalty,
            // Media
            s3Key: userReel?.s3Key || '',
            s3Url: reelMediaUrl,
            // Campaign object
            campaign: {
              _id: camp._id || t.campaignId,
              campaignName: camp.campaignName || '',
              brandName: camp.brandName || '',
              clientId: camp.clientId || '',
              description: camp.description || '',
              goal: camp.goal || '',
              views: camp.views || '',
              credits: camp.credits || 0,
              cutoff: camp.cutoff || 0,
              tNc: camp.tNc || '',
              tags: camp.tags || [],
              location: camp.location || '',
              status: camp.status || '',
              campaignType: camp.campaignType || 'private',
              supportedTaskTypes: camp.supportedTaskTypes || [],
              autoApproval: !!camp.autoApproval,
              startDate: camp.startDate || null,
              endDate: camp.endDate || null,
              image: { key: imgKey, url: campaignImageUrl },
              brandImage: { key: camp.brandImage?.key || '', url: brandImageUrl },
            },
            submission,
          };
        })
    );

    res.json({ success: true, tasks: enriched });
  } catch (err) {
    console.error('getPublicTasks:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/campaign-tasks/task/:taskId/submit-public
// User public task ka proof submit karta hai
exports.submitPublicTask = async (req, res) => {
  try {
    const { taskId }  = req.params;
    const { userId, proofUrl, proofKey } = req.body;

    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

    const task = await CampaignTask.findById(taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const isAssigned = (task.assignedTo || []).includes(userId);
    if (task.visibility !== 'public' && !isAssigned) {
      return res.status(400).json({ success: false, message: 'Task not available for this user' });
    }

    const alreadySubmitted = task.submissions.some(s => s.userId === userId && s.status !== 'rejected');
    if (alreadySubmitted) return res.status(400).json({ success: false, message: 'Already submitted' });

    // Remove old rejected submission if re-submitting
    task.submissions = task.submissions.filter(s => !(s.userId === userId && s.status === 'rejected'));

    task.submissions.push({
      userId,
      proofUrl:  proofUrl || '',
      proofKey:  proofKey || '',   // R2 key saved — used to generate fresh URLs
      submittedAt: new Date(),
      status: 'pending',
    });
    await task.save();

    await syncSharedReelSubmission(userId, taskId, task.campaignId, 'submit');

    res.json({
      success: true,
      message: 'Proof submitted successfully. Pending review.',
      TaskStatus: 'in_progress',
      submissionStatus: 'pending_review',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/campaign-tasks/task/:taskId/review-submission
// Client submission approve/reject karta hai
exports.reviewPublicSubmission = async (req, res) => {
  try {
    const { taskId }  = req.params;
    const { userId, status, customCredits } = req.body;

    if (!['approved', 'rejected'].includes(status))
      return res.status(400).json({ success: false, message: 'status must be approved or rejected' });

    // taskId could be either CampaignTask._id OR reelId (from UserResponse)
    // Try CampaignTask first
    let task = await CampaignTask.findById(taskId);
    
    // If not found, search by reelId in UserResponse
    if (!task) {
      const userResp = await UserResponse.findOne({ googleId: userId, 'response.reelId': taskId });
      if (!userResp) {
        return res.status(404).json({ success: false, message: 'Task or submission not found' });
      }
      
      // Handle UserResponse (reels/post) submission
      const respIndex = userResp.response.findIndex(r => String(r.reelId) === String(taskId));
      if (respIndex === -1) {
        return res.status(404).json({ success: false, message: 'Submission not found' });
      }
      
      const resp = userResp.response[respIndex];
      resp.status = status;
      
      if (status === 'approved') {
        resp.isCreditAccepted = true;
        const creditAmount = resp.creditAmount || 0;
        
        try {
          const wallet = await CreditWallet.findOneAndUpdate(
            { userId },
            { $inc: { totalBalance: creditAmount, acceptedCredits: creditAmount } },
            { new: true, upsert: true }
          );
          await TransactionHistory.create({
            userId,
            type: 'campaign_reward',
            amount: creditAmount,
            description: `Task completed: Post submission approved`,
            referenceType: 'task',
            referenceId: String(taskId),
            status: 'completed',
            meta: {
              campaignId: String(resp.campaignId),
              taskId: String(taskId),
              reason: 'Post submission approved by client',
            },
            balanceAfter: wallet.totalBalance,
          });
        } catch (e) {
          console.error('Credit wallet update failed:', e.message);
        }
      }
      
      await userResp.save();
      return res.json({ success: true, message: `Submission ${status}` });
    }
    
    // Handle CampaignTask (app_review/gmb_review) submission
    const sub = task.submissions.find(s => s.userId === userId);
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });

    sub.status = status;

    if (status === 'approved' && !task.completedBy.includes(userId)) {
      task.completedBy.push(userId);
      const creditsToGive = customCredits ? Number(customCredits) : task.credits;
      sub.creditsGiven = creditsToGive;

      try {
        const wallet = await CreditWallet.findOneAndUpdate(
          { userId },
          { $inc: { totalBalance: creditsToGive, acceptedCredits: creditsToGive } },
          { new: true, upsert: true }
        );
        await TransactionHistory.create({
          userId,
          type: 'campaign_reward',
          amount: creditsToGive,
          description: `Task completed: ${task.title}`,
          referenceType: 'task',
          referenceId: String(task._id),
          status: 'completed',
          meta: {
            campaignId: String(task.campaignId),
            taskId: String(task._id),
            reason: 'Task submission approved by client',
          },
          balanceAfter: wallet.totalBalance,
        });
      } catch (e) {
        console.error('Credit wallet update failed:', e.message);
      }
    }

    await task.save();

    if (status === 'approved') {
      await syncSharedReelSubmission(userId, taskId, task.campaignId, 'approve');
    } else {
      await SharedReels.updateOne(
        { googleId: userId, 'reels.campaignTaskId': String(taskId) },
        { $set: {
          'reels.$[elem].submissionStatus': 'rejected',
          'reels.$[elem].TaskStatus': 'accepted',
          'reels.$[elem].isTaskComplete': false,
        }},
        { arrayFilters: [{ 'elem.campaignTaskId': String(taskId) }] }
      );
    }

    res.json({ success: true, message: `Submission ${status}` });
  } catch (err) {
    console.error('reviewPublicSubmission:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/campaign-tasks/task/:taskId/submissions  — client ke liye
exports.getPublicSubmissions = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await CampaignTask.findById(taskId).lean();
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const { getobject } = require('../utils/r2');
    const submissions = await Promise.all((task.submissions || []).map(async (sub) => {
      let proofUrl = sub.proofUrl || '';
      if (sub.proofKey) {
        try { proofUrl = await getobject(sub.proofKey); } catch {}
      }
      return { ...sub, proofUrl };
    }));

    res.json({ success: true, submissions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/campaign-tasks/task/:taskId
exports.updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const allowed = ['title','description','platform','taskType','targetUrl','targetCount','credits','proofRequired','status','deadline','order','visibility','contentCategory','appName','businessName','minRating','script','referenceVideoUrl', 'targetViews', 'targetLikes', 'targetComments', 'targetChannels', 'cutoffViews'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.deadline) update.deadline = new Date(update.deadline);
    // post category ke liye targetUrl aur targetCount ignore
    const existingTask = await CampaignTask.findById(taskId).lean();
    if (existingTask?.contentCategory === 'post') {
      delete update.targetUrl;
      delete update.targetCount;
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

// POST /api/campaign-tasks/task/:taskId/assign  — Private task assign
exports.assignTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { userIds, assignToAll, assignmentScope, reelId, reelS3Url, reelS3Key, reelTitle } = req.body;

    const task = await CampaignTask.findById(taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const campaign = await Campaign.findById(task.campaignId).lean();

    let targetUserIds = Array.isArray(userIds) && userIds.length > 0 ? userIds : [];

    // Public task ya assignToAll — sare registered users ko assign karo
    const isPublicTask = task.visibility === 'public';
    const isPublicCampaign = campaign?.campaignType === 'public';

    if (assignToAll || isPublicTask || (isPublicCampaign && targetUserIds.length === 0)) {
      const MobileUser = require('../models/MobileUser');
      const allUsers = await MobileUser.find({ googleId: { $exists: true, $ne: null, $ne: '' } })
        .select('googleId').lean();
      targetUserIds = allUsers.map((u) => u.googleId).filter(Boolean);
    }

    if (!Array.isArray(targetUserIds) || targetUserIds.length === 0)
      return res.status(400).json({ success: false, message: 'No users to assign. For private tasks, provide userIds.' });

    const assignedCount = await assignCampaignTaskToUsers(
      task,
      targetUserIds,
      assignmentScope || (task.visibility === 'public' ? 'public' : 'private'),
      campaign || {}
    );

    // Save referenceVideoUrl directly on the main CampaignTask document
    if (reelS3Url || reelId) {
      task.referenceVideoUrl = reelS3Url || task.referenceVideoUrl || '';
      await task.save();
    }

    // Unconditionally update SharedReels for all target users (regardless of assignedCount)
    if (reelId || reelS3Url) {
      for (const googleId of targetUserIds) {
        await SharedReels.findOneAndUpdate(
          { googleId, 'reels.campaignTaskId': String(taskId) },
          {
            $set: {
              'reels.$.reelId': reelId || String(taskId),
              'reels.$.s3Key': reelS3Key || '',
              'reels.$.s3Url': reelS3Url || '',
              'reels.$.referenceVideoUrl': reelS3Url || '',
              'reels.$.title': reelTitle || task.title,
            },
          }
        );
      }
    }

    res.json({ success: true, message: `Task assigned to ${targetUserIds.length} user(s)`, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/campaign-tasks/task/:taskId/upload-proof  — screenshot upload to R2
exports.uploadPublicTaskProof = [
  uploadProof.single('file'),
  async (req, res) => {
    try {
      const { taskId } = req.params;
      if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

      const task = await CampaignTask.findById(taskId).lean();
      if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

      // Upload to R2
      try {
        const { r2Client, BUCKET_NAME } = require('../config/r2');
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const ext = path.extname(req.file.originalname) || path.extname(req.file.filename);
        const r2Key = `proofs/${req.file.filename}`;
        await r2Client.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: r2Key,
          Body: fs.readFileSync(req.file.path),
          ContentType: req.file.mimetype || 'image/jpeg',
        }));
        // Delete local temp file
        fs.unlink(req.file.path, () => {});
        const r2PublicUrl = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET_NAME}/${r2Key}`;
        // Use custom domain if set, else signed URL
        const { getobject } = require('../utils/r2');
        const signedUrl = await getobject(r2Key);
        return res.json({ success: true, url: signedUrl, r2Key });
      } catch (r2Err) {
        console.error('R2 upload failed, falling back to local:', r2Err.message);
        // Fallback: serve from local
        const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;
        const url = `${backendUrl}/uploads/proofs/${req.file.filename}`;
        return res.json({ success: true, url });
      }
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
];

// GET /api/campaign-tasks/:campaignId/participants
exports.getCampaignParticipants = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.json({ success: true, userIds: campaign.userIds || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/campaign-tasks/:campaignId/submissions-by-category?contentCategory=post
exports.getSubmissionsByCategory = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { contentCategory } = req.query;
    const filter = { campaignId: String(campaignId) };
    if (contentCategory) filter.contentCategory = contentCategory;

    const tasks = await CampaignTask.find(filter).lean();
    const { getobject } = require('../utils/r2');
    const UserResponse = require('../models/userResponse');
    const submissions = [];

    // Source 1: CampaignTask.submissions (app_review, gmb_review)
    for (const task of tasks) {
      for (const sub of task.submissions || []) {
        let proofUrl = sub.proofUrl || '';
        if (sub.proofKey) {
          try { proofUrl = await getobject(sub.proofKey); } catch {}
        }
        submissions.push({
          userId:          sub.userId,
          proofUrl,
          proofKey:        sub.proofKey || '',
          submittedAt:     sub.submittedAt,
          status:          sub.status || 'pending',
          creditsGiven:    sub.creditsGiven || 0,
          taskId:          task._id,
          taskTitle:       task.title,
          contentCategory: task.contentCategory,
          credits:         task.credits,
          platform:        task.platform,
          taskType:        task.taskType,
          visibility:      task.visibility,
        });
      }
    }

    // Source 2: UserResponse (reels, post)
    if (!contentCategory || contentCategory === 'reels' || contentCategory === 'post') {
      const userResponses = await UserResponse.find({ 'response.campaignId': String(campaignId) }).lean();
      for (const userResp of userResponses) {
        for (const resp of userResp.response || []) {
          if (String(resp.campaignId) !== String(campaignId)) continue;
          
          const task = tasks.find(t => String(t._id) === String(resp.reelId));
          const cat = task?.contentCategory || 'post';
          
          if (contentCategory && cat !== contentCategory) continue;
          
          submissions.push({
            userId:          userResp.googleId,
            proofUrl:        resp.urls || '',
            proofKey:        '',
            submittedAt:     resp.createdAt || new Date(),
            status:          resp.status || 'pending',
            creditsGiven:    resp.isCreditAccepted ? (resp.creditAmount || 0) : 0,
            taskId:          resp.reelId,
            taskTitle:       resp.campaignName || '',
            contentCategory: cat,
            credits:         resp.creditAmount || 0,
            platform:        'instagram',
            taskType:        'post',
            visibility:      'private',
            views:           resp.views || 0,
            likes:           resp.likes || 0,
            comments:        resp.comments || 0,
            cutoff:          resp.cutoff || 0,
          });
        }
      }
    }

    submissions.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));

    const stats = {
      total:        submissions.length,
      pending:      submissions.filter(s => s.status === 'pending').length,
      approved:     submissions.filter(s => s.status === 'approved').length,
      rejected:     submissions.filter(s => s.status === 'rejected').length,
      creditsGiven: submissions.filter(s => s.status === 'approved').reduce((sum, s) => sum + (s.creditsGiven || s.credits || 0), 0),
    };

    res.json({ success: true, submissions, stats, taskCount: tasks.length });
  } catch (err) {
    console.error('getSubmissionsByCategory:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
