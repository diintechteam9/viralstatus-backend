const Activity    = require('../models/Activity');
const MobileUser  = require('../models/MobileUser');
const SharedReels = require('../models/SharedReels');
const CreditWallet= require('../models/CreditWallet');
const Campaign    = require('../models/campaign');

// ── GET /api/activity — live activity feed ───────────────────────────────────
exports.getLiveActivity = async (req, res) => {
  try {
    const { type, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (type) filter.type = type;

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Activity.countDocuments(filter);
    const list  = await Activity.find(filter)
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean();

    res.json({ success: true, activities: list, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/activity/stats — home screen overview stats ────────────────────
// Returns: totalEarnings, totalViews, totalLikes, totalTasks, totalTaskRecords,
//          totalCampaigns (joined by user), totalTasksCompleted
exports.getHomeStats = async (req, res) => {
  try {
    const userId = String(req.user.id);
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

    // ── Wallet (earnings) ──────────────────────────────────────────────────
    const wallet = await CreditWallet.findOne({ userId }).lean();

    // ── SharedReels (tasks) ────────────────────────────────────────────────
    const sharedDoc = await SharedReels.findOne({ googleId: userId }).lean();
    const reels = sharedDoc?.reels || [];

    const totalTasks          = reels.length;
    const totalTasksCompleted = reels.filter(r => r.isTaskComplete || r.TaskStatus === 'completed').length;
    const totalTaskRecords    = reels.filter(r => r.submissionUrl || r.TaskStatus !== 'assigned').length;

    // Unique campaigns joined
    const campaignIds = [...new Set(reels.map(r => r.campaignId).filter(Boolean))];
    const totalCampaigns = campaignIds.length;

    // ── Social stats (from userResponse / pool responses) ─────────────────
    // We aggregate views and likes from userResponse
    const UserResponse = require('../models/userResponse');
    const userResp = await UserResponse.findOne({ googleId: userId }).lean();
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    if (userResp?.response) {
      for (const r of userResp.response) {
        totalViews    += Number(r.views    || 0);
        totalLikes    += Number(r.likes    || 0);
        totalComments += Number(r.comments || 0);
      }
    }

    res.json({
      success: true,
      stats: {
        totalEarnings:       wallet?.totalBalance      || 0,
        totalViews,
        totalLikes,
        totalComments,
        totalTasks,
        totalCampaigns,
      },
    });
  } catch (err) {
    console.error('[Activity] getHomeStats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Helper: log activity from anywhere ───────────────────────────────────────
exports.logActivity = async (data) => {
  try {
    await Activity.create(data);
  } catch (e) {
    console.error('[Activity] log error:', e.message);
  }
};
