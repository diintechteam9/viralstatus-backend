const express = require('express');
const router = express.Router();
const poolController = require('../controllers/poolController');
const reelController = require('../controllers/reelcontroller');

// ─── Static / specific routes FIRST (before any /:param routes) ───────────────

// Pool CRUD
router.post('/', poolController.createPool);
router.get('/', poolController.getPools);
router.put('/:id', poolController.updatePool);
router.delete('/:id', poolController.deletePool);

// YouTube stats
router.get('/stats', reelController.getYoutubeVideoStats);

// Shared reels
router.post('/shared', reelController.assignReelsToUsersWithCount);
router.get('/shared/:userId', reelController.getSharedReelsForUser);
router.post('/shared/complete/:userId/:reelId', reelController.updateTaskCompleted);
router.post('/shared/accepted/:userId/:reelId', reelController.updateTaskAccepted);
router.post('/shared/task-accepted/:userId/:reelId', reelController.acceptTaskStatus);
router.post('/shared/task-completed/:userId/:reelId', reelController.completeTaskStatus);

// User response
router.post('/user/response/:userId', reelController.addUserResponseUrl);
router.get('/user/response/get/:userId', reelController.getAddUserResponseUrl);

// Reel delete (static paths before /:poolId)
router.delete('/reels/:reelId', reelController.deleteReel);
router.delete('/reels', reelController.deleteMultipleReels);

// Approved credits
router.post('/reels/approved/:campaignId', reelController.approveCreditsForUser);

// ─── Dynamic /:poolId routes ──────────────────────────────────────────────────

// Old upload (busboy - server side)
router.post('/:poolId/upload', reelController.uploadReels);

// Fast multi upload: Step 1 - get presigned PUT URLs
router.post('/:poolId/presigned-urls', reelController.getPresignedUrls);

// Fast multi upload: Step 2 - save metadata after direct R2 upload
router.post('/:poolId/save-reels', reelController.saveReelMetadata);

// Get reels by pool
router.get('/:poolId/reels', reelController.getReelsByPoolId);

// Delete all reels from pool
router.delete('/:poolId/reels', reelController.deleteAllReelsFromPool);

// Get single pool by id
router.get('/:id', async (req, res) => {
  try {
    const pool = await require('../models/pool').findById(req.params.id);
    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    res.json({ pool });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pool', details: err.message });
  }
});

module.exports = router;