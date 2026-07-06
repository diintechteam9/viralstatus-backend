const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/bannerController');
const { authenticate, authorize } = require('../middleware/authenticate');

const clientOnly = [authenticate, authorize('client', 'admin', 'super_admin')];
const mobileOnly = [authenticate, authorize('mobileuser')];
const clientOrMobile = [authenticate, authorize('client', 'admin', 'super_admin', 'mobileuser')];

// User/Client/Admin — fetch banners
router.get('/', ...clientOrMobile, ctrl.getBanners);

// Client / Admin — manage banners
router.post('/',     ...clientOnly, ctrl.createBanner);
router.patch('/:id', ...clientOnly, ctrl.updateBanner);
router.delete('/:id',...clientOnly, ctrl.deleteBanner);

module.exports = router;
