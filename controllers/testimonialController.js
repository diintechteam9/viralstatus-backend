const Testimonial = require('../models/Testimonial');
const Activity    = require('../models/Activity');
const MobileUser  = require('../models/MobileUser');

// ── POST /api/testimonials — user submits review ─────────────────────────────
exports.createTestimonial = async (req, res) => {
  try {
    const { userId, rating, review, campaignId, campaignName, clientId } = req.body;
    if (!userId || !rating || !review?.trim()) {
      return res.status(400).json({ success: false, message: 'userId, rating, review required' });
    }
    if (Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be 1-5' });
    }

    // Get user info
    const user = await MobileUser.findOne({ googleId: userId })
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
      clientId:     clientId     || '',
      isApproved:   false, // needs admin approval
    });

    Activity.create({
      actorId: userId, actorName: user?.name || '', actorRole: 'user',
      type: 'review_posted',
      description: `${user?.name || userId} posted a ${rating}★ review`,
      meta: { campaignId: campaignId || '', campaignName: campaignName || '' },
      clientId: clientId || '',
    }).catch(() => {});

    res.status(201).json({ success: true, testimonial, message: 'Review submitted for approval' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/testimonials — public: approved testimonials ────────────────────
exports.getTestimonials = async (req, res) => {
  try {
    const { clientId, limit = 20, page = 1 } = req.query;
    const filter = { isApproved: true, isVisible: true };
    if (clientId) filter.clientId = clientId;

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Testimonial.countDocuments(filter);
    const list  = await Testimonial.find(filter)
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean();

    res.json({ success: true, testimonials: list, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/testimonials/admin — admin: all (incl. pending) ─────────────────
exports.adminGetTestimonials = async (req, res) => {
  try {
    const { isApproved, clientId, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (clientId) filter.clientId = clientId;
    if (isApproved !== undefined) filter.isApproved = isApproved === 'true';

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Testimonial.countDocuments(filter);
    const list  = await Testimonial.find(filter)
      .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean();

    res.json({ success: true, testimonials: list, total });
  } catch (err) {
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
    if (!t) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, testimonial: t });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/testimonials/:id ─────────────────────────────────────────────
exports.deleteTestimonial = async (req, res) => {
  try {
    await Testimonial.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
