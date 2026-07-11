const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/ugcVideoController');
const { authenticate, authorize } = require('../middleware/authenticate');

const allAccess = authorize('client', 'admin', 'super_admin', 'mobileuser');

// Upload URL — get R2 presigned URL before uploading
router.post('/upload-url', authenticate, allAccess, ctrl.getUploadUrl);

// Submit video after R2 upload
router.post('/', authenticate, allAccess, ctrl.submitVideo);

// Get user's submitted videos (role-based: mobileuser gets own, client gets all)
router.get('/', authenticate, allAccess, ctrl.getUserVideos);

// Get processing status (AI pipeline polling)
router.get('/:id/status', authenticate, allAccess, ctrl.getProcessingStatus);

// Request editing — mobileuser clicks "Edit Video"
router.post('/:id/request-edit', authenticate, allAccess, ctrl.requestEdit);

// Accept edited video — mobileuser approves the edited version
router.post('/:id/accept', authenticate, allAccess, ctrl.acceptEditedVideo);

// Reject edited video — mobileuser rejects, sends back for re-edit
router.post('/:id/reject', authenticate, allAccess, ctrl.rejectEditedVideo);

// Update video status (approve/reject) — client only
router.patch('/:id', authenticate, authorize('client', 'admin', 'super_admin'), ctrl.updateVideoStatus);

// Update settings
router.patch('/:id/settings', authenticate, authorize('client', 'admin', 'super_admin'), ctrl.updateAutoApprovalSettings);

// Raise objection
router.patch('/:id/objection', authenticate, authorize('client', 'admin', 'super_admin'), ctrl.submitObjection);

// Submit edited video
router.patch('/:id/edited', authenticate, authorize('client', 'admin', 'super_admin'), ctrl.submitEditedVideo);

// Delete a video
router.delete('/:id', authenticate, allAccess, ctrl.deleteVideo);

module.exports = router;
