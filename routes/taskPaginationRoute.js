/**
 * Task Pagination Route
 * GET /api/tasks/:userId?page=1&limit=10&status=all|pending|completed|accepted
 *
 * Wraps the existing SharedReels data with pagination support.
 * Android app should use this instead of /api/pools/shared/:userId for paginated task lists.
 */
const express   = require('express');
const router    = express.Router();
const SharedReels = require('../models/SharedReels');
const Campaign    = require('../models/campaign');

// ── GET /api/tasks/:userId ────────────────────────────────────────────────────
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      page   = 1,
      limit  = 10,
      status = 'all',  // all | pending | completed | accepted | rejected | in_progress
    } = req.query;

    const shared = await SharedReels.findOne({ googleId: userId }).lean();
    if (!shared || !Array.isArray(shared.reels)) {
      return res.json({ success: true, tasks: [], total: 0, page: 1, totalPages: 0 });
    }

    const now = new Date();

    // Get campaign info to filter expired
    const campaignIds = [...new Set(shared.reels.map(r => r.campaignId).filter(Boolean))];
    const campaigns   = await Campaign.find({ _id: { $in: campaignIds } })
      .select('_id endDate status campaignName brandName credits image').lean();

    const campaignMap = new Map(campaigns.map(c => [String(c._id), c]));
    const expiredSet  = new Set(
      campaigns.filter(c => c.endDate && new Date(c.endDate) < now).map(c => String(c._id))
    );

    // Filter reels
    let filtered = shared.reels.filter(r => {
      if (expiredSet.has(String(r.campaignId))) return false;
      if (r.TaskStatus === 'rejected') return false;
      return true;
    });

    // Status filter
    if (status !== 'all') {
      filtered = filtered.filter(r => {
        if (status === 'completed') return r.isTaskComplete || r.TaskStatus === 'completed';
        if (status === 'pending')   return !r.isTaskAccepted && r.TaskStatus === 'assigned';
        if (status === 'accepted')  return r.isTaskAccepted && !r.isTaskComplete;
        if (status === 'in_progress') return r.TaskStatus === 'in_progress';
        return r.TaskStatus === status;
      });
    }

    const total      = filtered.length;
    const pageNum    = Math.max(1, Number(page));
    const pageSize   = Math.min(50, Math.max(1, Number(limit)));
    const totalPages = Math.ceil(total / pageSize);
    const skip       = (pageNum - 1) * pageSize;

    const paginated  = filtered
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(skip, skip + pageSize)
      .map(r => {
        const campaign = campaignMap.get(String(r.campaignId)) || {};
        return {
          ...r,
          campaign: {
            _id:         campaign._id         || r.campaignId,
            campaignName: campaign.campaignName || r.campaignName || '',
            brandName:    campaign.brandName    || r.brandName    || '',
            credits:      campaign.credits      || r.credits      || 0,
            image:        campaign.image        || null,
          },
        };
      });

    res.json({
      success:    true,
      tasks:      paginated,
      total,
      page:       pageNum,
      limit:      pageSize,
      totalPages,
      hasNext:    pageNum < totalPages,
      hasPrev:    pageNum > 1,
    });
  } catch (err) {
    console.error('[TaskPagination] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
