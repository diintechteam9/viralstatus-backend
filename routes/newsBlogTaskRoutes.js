'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/newsBlogTaskController');
const { authenticate, authorize } = require('../middleware/authenticate');

// ── Client routes ──────────────────────────────────────────────────────────────
router.post('/',                      authenticate, authorize('client', 'admin', 'super_admin'), ctrl.createTask);
router.get('/client/:clientId',       authenticate, authorize('client', 'admin', 'super_admin'), ctrl.getTasksByClient);
router.put('/:taskId',                authenticate, authorize('client', 'admin', 'super_admin'), ctrl.updateTask);
router.delete('/:taskId',             authenticate, authorize('client', 'admin', 'super_admin'), ctrl.deleteTask);
router.get('/:taskId/submissions',    authenticate, authorize('client', 'admin', 'super_admin'), ctrl.getSubmissions);
router.patch('/submission/:subId/review', authenticate, authorize('client', 'admin', 'super_admin'), ctrl.reviewSubmission);

// ── User routes (public + googleId) ──────────────────────────────────────────
router.get('/user/:googleId/tasks',       ctrl.getUserTasks);
router.post('/:taskId/submit',            ctrl.submitTask);
router.get('/user/:googleId/submissions', ctrl.getMySubmissions);

// ── Single task (public) ──────────────────────────────────────────────────────
router.get('/:taskId', ctrl.getTaskById);

module.exports = router;
