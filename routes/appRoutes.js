const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/authenticate');
const ctrl = require('../controllers/appController');

const adminOnly = [authenticate, authorize('admin', 'super_admin')];

// Public
router.post('/login', ctrl.loginApp);

// Admin protected
router.get('/', ...adminOnly, ctrl.getAllApps);
router.post('/', ...adminOnly, ctrl.uploadLogo.single('businessLogo'), ctrl.createApp);
router.get('/:appId', ...adminOnly, ctrl.getAppById);
router.put('/:appId', ...adminOnly, ctrl.uploadLogo.single('businessLogo'), ctrl.updateApp);
router.delete('/:appId', ...adminOnly, ctrl.deleteApp);

module.exports = router;
