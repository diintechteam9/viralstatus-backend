const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/testimonialController');
const { authenticate, authorize } = require('../middleware/authenticate');

const adminOnly = [authenticate, authorize('admin', 'super_admin', 'client')];

// Admin routes — MUST be before /:id routes
router.get('/admin',             ...adminOnly, ctrl.adminGetTestimonials);
router.patch('/:id/approve',     ...adminOnly, ctrl.approveTestimonial);
router.delete('/:id',            ...adminOnly, ctrl.deleteTestimonial);

// Public — android app fetches approved testimonials
router.get('/',               ctrl.getTestimonials);

// User — submit review
router.post('/',              ctrl.createTestimonial);

module.exports = router;
