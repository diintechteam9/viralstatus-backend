const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/ugcVideoController');
const { authenticate, authorize } = require('../middleware/authenticate');

const allAccess = authorize('client', 'admin', 'super_admin', 'mobileuser');

// Upload URL — get R2 presigned URL before uploading
router.post('/upload-url', authenticate, allAccess, ctrl.getUploadUrl);

// Submit video after R2 upload
router.post('/', authenticate, allAccess, ctrl.submitVideo);

// Get user's submitted videos
router.get('/', authenticate, allAccess, ctrl.getUserVideos);

// Delete a video
router.delete('/:id', authenticate, allAccess, ctrl.deleteVideo);

module.exports = router;
