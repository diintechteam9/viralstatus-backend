'use strict';
const NewsBlogTask       = require('../models/NewsBlogTask');
const NewsBlogSubmission = require('../models/NewsBlogSubmission');
const NewsBlog           = require('../models/NewsBlog');
const CreditWallet       = require('../models/CreditWallet');

// ─── CLIENT: Create task from a news/blog post ────────────────────────────────
exports.createTask = async (req, res) => {
  try {
    const { newsBlogId, clientId, credits, deadline, platform, instructions, status } = req.body;
    if (!newsBlogId || !clientId || credits === undefined) {
      return res.status(400).json({ success: false, message: 'newsBlogId, clientId, credits are required' });
    }
    const post = await NewsBlog.findById(newsBlogId).lean();
    if (!post) return res.status(404).json({ success: false, message: 'News/Blog post not found' });

    // Prevent duplicate task for same post+client
    const existing = await NewsBlogTask.findOne({ newsBlogId, clientId });
    if (existing) return res.status(409).json({ success: false, message: 'Task already exists for this post', task: existing });

    const task = await NewsBlogTask.create({
      newsBlogId,
      clientId,
      title:        post.title,
      summary:      post.summary || '',
      imageUrl:     post.imageUrl || '',
      category:     post.category || 'News',
      content:      post.content || '',
      credits:      Number(credits),
      deadline:     deadline || null,
      platform:     platform || 'any',
      instructions: instructions || '',
      status:       status || 'active',
    });

    res.status(201).json({ success: true, task });
  } catch (err) {
    console.error('[NewsBlogTask] createTask:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CLIENT: Get all tasks by clientId ────────────────────────────────────────
exports.getTasksByClient = async (req, res) => {
  try {
    const { clientId } = req.params;
    const tasks = await NewsBlogTask.find({ clientId }).sort({ createdAt: -1 }).lean();

    // Attach submission counts
    const ids = tasks.map(t => t._id);
    const subCounts = await NewsBlogSubmission.aggregate([
      { $match: { taskId: { $in: ids } } },
      { $group: { _id: '$taskId', total: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } }, approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } } } },
    ]);
    const countMap = Object.fromEntries(subCounts.map(c => [String(c._id), c]));

    const enriched = tasks.map(t => ({
      ...t,
      submissionStats: countMap[String(t._id)] || { total: 0, pending: 0, approved: 0 },
    }));

    res.json({ success: true, tasks: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CLIENT: Get one task ─────────────────────────────────────────────────────
exports.getTaskById = async (req, res) => {
  try {
    const task = await NewsBlogTask.findById(req.params.taskId).lean();
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CLIENT: Update task ──────────────────────────────────────────────────────
exports.updateTask = async (req, res) => {
  try {
    const allowed = ['credits', 'deadline', 'platform', 'instructions', 'status'];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    const task = await NewsBlogTask.findByIdAndUpdate(req.params.taskId, update, { new: true });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CLIENT: Delete task ──────────────────────────────────────────────────────
exports.deleteTask = async (req, res) => {
  try {
    const task = await NewsBlogTask.findByIdAndDelete(req.params.taskId);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CLIENT: Get all submissions for a task ───────────────────────────────────
exports.getSubmissions = async (req, res) => {
  try {
    const subs = await NewsBlogSubmission.find({ taskId: req.params.taskId }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, submissions: subs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── CLIENT: Review submission (approve / reject) ─────────────────────────────
exports.reviewSubmission = async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be approved or rejected' });
    }

    const sub = await NewsBlogSubmission.findById(req.params.subId);
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });

    sub.status = status;
    sub.reviewedAt = new Date();
    if (status === 'rejected') sub.rejectionReason = rejectionReason || '';

    // Award credits on approval (once)
    if (status === 'approved' && !sub.isCreditAwarded) {
      const task = await NewsBlogTask.findById(sub.taskId).lean();
      const amount = task?.credits || sub.credits || 0;
      sub.credits = amount;
      sub.isCreditAwarded = true;

      // Add to CreditWallet (userId = googleId in this schema)
      try {
        await CreditWallet.findOneAndUpdate(
          { userId: sub.googleId },
          { $inc: { totalBalance: amount, acceptedCredits: amount } },
          { upsert: true, new: true }
        );
      } catch (walletErr) {
        console.error('[NewsBlogTask] wallet credit error:', walletErr.message);
      }
    }

    await sub.save();
    res.json({ success: true, submission: sub });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── USER: Get all active tasks (for user to browse) ─────────────────────────
exports.getUserTasks = async (req, res) => {
  try {
    const { googleId } = req.params;
    // Fetch all active tasks
    const tasks = await NewsBlogTask.find({ status: 'active' }).sort({ createdAt: -1 }).lean();

    // Attach user's submission status per task
    const taskIds = tasks.map(t => t._id);
    const userSubs = await NewsBlogSubmission.find({ googleId, taskId: { $in: taskIds } }).lean();
    const subMap = Object.fromEntries(userSubs.map(s => [String(s.taskId), s]));

    const enriched = tasks.map(t => ({
      ...t,
      mySubmission: subMap[String(t._id)] || null,
    }));

    res.json({ success: true, tasks: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── USER: Submit post URL ────────────────────────────────────────────────────
exports.submitTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { googleId, postUrl, platform } = req.body;

    if (!googleId || !postUrl) {
      return res.status(400).json({ success: false, message: 'googleId and postUrl are required' });
    }

    const task = await NewsBlogTask.findById(taskId).lean();
    if (!task || task.status !== 'active') {
      return res.status(404).json({ success: false, message: 'Task not found or not active' });
    }

    // Upsert submission
    const sub = await NewsBlogSubmission.findOneAndUpdate(
      { taskId, googleId },
      {
        $set: {
          newsBlogId: task.newsBlogId,
          clientId:   task.clientId,
          postUrl:    postUrl.trim(),
          platform:   platform || 'other',
          status:     'pending',
          credits:    task.credits,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Track in assignedTo
    await NewsBlogTask.findByIdAndUpdate(taskId, { $addToSet: { assignedTo: googleId } });

    res.json({ success: true, submission: sub });
  } catch (err) {
    console.error('[NewsBlogTask] submitTask:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── USER: Get my submissions ─────────────────────────────────────────────────
exports.getMySubmissions = async (req, res) => {
  try {
    const { googleId } = req.params;
    const subs = await NewsBlogSubmission.find({ googleId }).sort({ createdAt: -1 }).lean();

    // Attach task info
    const taskIds = subs.map(s => s.taskId);
    const tasks   = await NewsBlogTask.find({ _id: { $in: taskIds } }).lean();
    const taskMap = Object.fromEntries(tasks.map(t => [String(t._id), t]));

    const enriched = subs.map(s => ({ ...s, task: taskMap[String(s.taskId)] || null }));
    res.json({ success: true, submissions: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
