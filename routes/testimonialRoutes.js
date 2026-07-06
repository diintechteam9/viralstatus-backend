const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/testimonialController');
const { authenticate, authorize } = require('../middleware/authenticate');

const adminOnly  = [authenticate, authorize('admin', 'super_admin', 'client')];
const mobileOnly = [authenticate, authorize('mobileuser')];

// Admin routes
router.get('/admin',         ...adminOnly,  ctrl.adminGetTestimonials);
router.patch('/:id/approve', ...adminOnly,  ctrl.approveTestimonial);
router.delete('/:id',        ...adminOnly,  ctrl.deleteTestimonial);

// User — auth required, userId from token
router.get('/',  ...mobileOnly, ctrl.getTestimonials);
router.post('/', ...mobileOnly, ctrl.createTestimonial);

module.exports = router;
