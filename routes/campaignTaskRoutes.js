const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/campaignTaskController');

// Static routes pehle (param routes baad me — warna /public/all ko /:campaignId match kar leta hai)
router.get('/public/all',                       ctrl.getPublicTasks);
router.post('/',                                ctrl.createTask);
router.post('/:campaignId/generate',            ctrl.generateCampaignTasks);
router.post('/:campaignId/distribute',          ctrl.distributeCampaignTasks);

// Task-specific routes
router.get('/task/:taskId',                     ctrl.getTaskById);
router.post('/task/:taskId/submit-public',      ctrl.submitPublicTask);
router.post('/task/:taskId/upload-proof',       ctrl.uploadPublicTaskProof);
router.patch('/task/:taskId/review-submission', ctrl.reviewPublicSubmission);
router.get('/task/:taskId/submissions',         ctrl.getPublicSubmissions);
router.put('/task/:taskId',                     ctrl.updateTask);
router.delete('/task/:taskId',                  ctrl.deleteTask);
router.patch('/task/:taskId/status',            ctrl.updateTaskStatus);
router.post('/task/:taskId/assign',             ctrl.assignTask);

// Campaign-param routes (specific pehle, general baad me)
router.get('/:campaignId/submissions-by-category', ctrl.getSubmissionsByCategory);
router.get('/:campaignId/participants',         ctrl.getCampaignParticipants);
router.get('/:campaignId',                      ctrl.getTasksByCampaign);

module.exports = router;
