const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/campaignTaskController');

router.post('/',                                ctrl.createTask);
router.get('/:campaignId',                     ctrl.getTasksByCampaign);
router.get('/:campaignId/participants',         ctrl.getCampaignParticipants);
router.put('/task/:taskId',                    ctrl.updateTask);
router.delete('/task/:taskId',                 ctrl.deleteTask);
router.patch('/task/:taskId/status',           ctrl.updateTaskStatus);
router.post('/task/:taskId/assign',            ctrl.assignTask);

module.exports = router;
