const CampaignTask = require('../models/CampaignTask');
const Campaign     = require('../models/campaign');
const SharedReels  = require('../models/SharedReels');
const UGCForm      = require('../models/UGCForm');
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
            // Task-specific fields stored at assignment time
            description: task.description || '',
            targetUrl: task.targetUrl || '',
            targetCount: task.targetCount || 0,
            appName: task.appName || '',
            businessName: task.businessName || '',
            minRating: task.minRating || '',
            script: task.script || '',
            referenceVideoUrl: task.referenceVideoUrl || '',
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
      targetCount: contentCategory === 'post' ? 0 : targetCount,
      targetUrl: contentCategory === 'post' ? '' : (req.body.targetUrl || ''),
      credits,
      proofRequired, status, deadline, order,
      visibility: visibility || 'private',
      contentCategory: contentCategory || 'post',
      appName: appName || '',
      businessName: businessName || '',
      minRating: minRating || '5',
      script: script || '',
      referenceVideoUrl: referenceVideoUrl || '',
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
    const task = await CampaignTask.findById(req.params.taskId).lean();
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const campaign = await Campaign.findById(task.campaignId).lean();
    const userId = req.query.userId;

    res.json({
      success: true,
      task: {
        ...task,
        campaignName: campaign?.campaignName || '',
        campaignImageUrl: campaign?.image?.url || '',
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
    const tasks = await CampaignTask.find({ campaignId }).sort({ order: 1, createdAt: -1 }).lean();
    res.json({ success: true, tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/campaign-tasks/public/all  — saare active public tasks (kisi bhi user ke liye)
exports.getPublicTasks = async (req, res) => {
  try {
    const { userId } = req.query; // optional — to check if already completed
    const tasks = await CampaignTask.find({ visibility: 'public', status: 'active' })
      .sort({ createdAt: -1 })
      .lean();

    // Campaign info attach karo (name, image)
    const campaignIds = [...new Set(tasks.map(t => t.campaignId))];
    const campaigns   = await Campaign.find({ _id: { $in: campaignIds } }).lean();
    const campMap     = {};
    campaigns.forEach(c => { campMap[String(c._id)] = c; });

    const enriched = tasks.map(t => {
      const camp = campMap[t.campaignId] || {};
      return {
        ...t,
        contentCategory: t.contentCategory || 'post',
        campaignName:     camp.campaignName || '',
        campaignImageUrl: camp.image?.url   || '',
        brandName:        camp.brandName    || '',
        alreadyCompleted: userId ? (t.completedBy || []).includes(userId) : false,
        alreadySubmitted: userId
          ? (t.submissions || []).some(s => s.userId === userId)
          : false,
      };
    });

    res.json({ success: true, tasks: enriched });
  } catch (err) {
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

    const alreadySubmitted = task.submissions.some(s => s.userId === userId);
    if (alreadySubmitted) return res.status(400).json({ success: false, message: 'Already submitted' });

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

    const task = await CampaignTask.findById(taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const sub = task.submissions.find(s => s.userId === userId);
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });

    sub.status = status;

    // Agar approved to completedBy me add karo
    if (status === 'approved' && !task.completedBy.includes(userId)) {
      task.completedBy.push(userId);

      // Custom credits override support — client approve karte waqt custom amount de sakta hai
      const creditsToGive = customCredits ? Number(customCredits) : task.credits;
      sub.creditsGiven = creditsToGive;

      try {
        const CreditWallet = require('../models/CreditWallet');
        await CreditWallet.findOneAndUpdate(
          { userId },
          { $inc: { totalBalance: creditsToGive, acceptedCredits: creditsToGive } },
          { upsert: true }
        );
      } catch (e) {
        console.error('Credit wallet update failed:', e.message);
      }
    }

    await task.save();

    if (status === 'approved') {
      await syncSharedReelSubmission(userId, taskId, task.campaignId, 'approve');
    } else {
      await syncSharedReelSubmission(userId, taskId, task.campaignId, 'reject');
    }

    res.json({ success: true, message: `Submission ${status}` });
  } catch (err) {
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
    const allowed = ['title','description','platform','taskType','targetUrl','targetCount','credits','proofRequired','status','deadline','order','visibility','contentCategory','appName','businessName','minRating','script','referenceVideoUrl'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
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

    let targetUserIds = userIds;
    if (assignToAll || (task.visibility === 'public' && (!Array.isArray(userIds) || userIds.length === 0))) {
      targetUserIds = await resolveTargetUserIds(campaign || {}, []);
    }

    if (!Array.isArray(targetUserIds) || targetUserIds.length === 0)
      return res.status(400).json({ success: false, message: 'No users to assign' });

    const assignedCount = await assignCampaignTaskToUsers(
      task,
      targetUserIds,
      assignmentScope || (task.visibility === 'public' ? 'public' : 'private'),
      campaign || {}
    );

    // Optional reel attachment for upload_reel type
    if (reelId && assignedCount > 0) {
      for (const googleId of targetUserIds) {
        await SharedReels.findOneAndUpdate(
          { googleId, 'reels.campaignTaskId': String(taskId) },
          {
            $set: {
              'reels.$.reelId': reelId,
              'reels.$.s3Key': reelS3Key || '',
              'reels.$.s3Url': reelS3Url || '',
              'reels.$.title': reelTitle || task.title,
            },
          }
        );
      }
    }

    res.json({ success: true, message: `Task assigned to ${assignedCount} user(s)`, task });
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
    const submissions = [];

    for (const task of tasks) {
      for (const sub of task.submissions || []) {
        // Generate fresh signed URL from R2 key if available
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
    res.status(500).json({ success: false, message: err.message });
  }
};
