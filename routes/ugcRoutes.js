const express = require('express');
const router  = express.Router();
const ugc     = require('../controllers/ugcController');
const { authenticate, authorize } = require('../middleware/authenticate');

const clientOnly = [authenticate, authorize('client', 'admin', 'super_admin')];
const mobileOnly = [authenticate, authorize('mobileuser')];

// Client: save UGC form
router.post('/form/:campaignId', ...clientOnly, ugc.saveUGCForm);

// User: get UGC form + context — userId from token
router.get('/form/:campaignId',  ...mobileOnly, ugc.getUGCForm);

// User: upload UGC video — userId from token
router.post('/submit',           ...mobileOnly, ugc.uploadUGCVideo);

// User: get own submission — userId from token
router.get('/submission/:campaignId', ...mobileOnly, ugc.getUserUGCSubmission);

// Client: get all submissions for a campaign
router.get('/submissions/:campaignId', ...clientOnly, ugc.getUGCSubmissions);

// Client: approve/reject submission
router.patch('/submission/:submissionId/status', ...clientOnly, ugc.updateUGCSubmissionStatus);

module.exports = router;
