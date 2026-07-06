const Testimonial = require('../models/Testimonial');
const Activity    = require('../models/Activity');
const MobileUser  = require('../models/MobileUser');

// ── POST /api/testimonials — user submits review ─────────────────────────────
exports.createTestimonial = async (req, res) => {
  try {
    const userId   = String(req.user.id);
    const { rating, review, campaignId, campaignName } = req.body;
    if (!rating || !review?.trim()) {
      return res.status(400).json({ success: false, message: 'rating, review required' });
    }
    if (Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be 1-5' });
    }

    // Get user info
    const user = await MobileUser.findById(userId)
      .select('name city profileImageUrl').lean();

    const testimonial = await Testimonial.create({
      userId,
      userName:     user?.name   || '',
      userCity:     user?.city   || '',
      avatarUrl:    user?.profileImageUrl || '',
      rating:       Number(rating),
      review:       review.trim(),
      campaignId:   campaignId   || '',
      campaignName: campaignName || '',
      clientId:     '',
      isApproved:   false,
    });

    Activity.create({
      actorId: userId, actorName: user?.name || '', actorRole: 'user',
      type: 'review_posted',
      description: `${user?.name || userId} posted a ${rating}★ review`,
      meta: { campaignId: campaignId || '', campaignName: campaignName || '' },
    }).catch(() => {});

    res.status(201).json({ success: true, testimonial, message: 'Review submitted for approval' });
  } catch (err) {
    console.error('[Testimonial] create error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/testimonials — public: approved testimonials ────────────────────
exports.getTestimonials = async (req, res) => {
  try {
    const { limit = 20, page = 1 } = req.query;
    const filter = { isApproved: true, isVisible: true };

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Testimonial.countDocuments(filter);
    const list  = await Testimonial.find(filter)
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean();

    res.json({ success: true, testimonials: list, total, page: Number(page) });
  } catch (err) {
    console.error('[Testimonial] getTestimonials error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/testimonials/admin — admin: all (incl. pending) ─────────────────
exports.adminGetTestimonials = async (req, res) => {
  try {
    const { isApproved, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (isApproved !== undefined) filter.isApproved = isApproved === 'true';

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Testimonial.countDocuments(filter);
    const list  = await Testimonial.find(filter)
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean();

    res.json({ success: true, testimonials: list, total, page: Number(page) });
  } catch (err) {
    console.error('[Testimonial] adminGetTestimonials error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/testimonials/:id/approve — admin approve/reject ───────────────
exports.approveTestimonial = async (req, res) => {
  try {
    const { isApproved, isVisible } = req.body;
    const t = await Testimonial.findByIdAndUpdate(
      req.params.id,
      { isApproved, isVisible: isVisible !== false },
      { new: true }
    );
    if (!t) return res.status(404).json({ success: false, message: 'Testimonial not found' });
    res.json({ success: true, testimonial: t, message: 'Testimonial updated' });
  } catch (err) {
    console.error('[Testimonial] approve error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/testimonials/:id ─────────────────────────────────────────────
exports.deleteTestimonial = async (req, res) => {
  try {
    const t = await Testimonial.findByIdAndDelete(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: 'Testimonial not found' });
    res.json({ success: true, message: 'Testimonial deleted successfully' });
  } catch (err) {
    console.error('[Testimonial] delete error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
