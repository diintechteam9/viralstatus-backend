const express = require('express');
const router = express.Router();
const ugc = require('../controllers/ugcController');
const { authenticate, authorize } = require('../middleware/authenticate');

// Client: save/get UGC form
router.post('/form/:campaignId', authenticate, authorize('client', 'admin', 'super_admin'), ugc.saveUGCForm);
router.get('/form/:campaignId/:userId', ugc.getUGCForm);
router.get('/form/:campaignId', ugc.getUGCForm);

// User: upload UGC video
router.post('/submit', ugc.uploadUGCVideo);

// User: get own submission
router.get('/submission/:campaignId/:userId', ugc.getUserUGCSubmission);

// Client: get all submissions for a campaign
router.get('/submissions/:campaignId', authenticate, authorize('client', 'admin', 'super_admin'), ugc.getUGCSubmissions);

// Client: approve/reject submission
router.patch('/submission/:submissionId/status', authenticate, authorize('client', 'admin', 'super_admin'), ugc.updateUGCSubmissionStatus);

module.exports = router;
