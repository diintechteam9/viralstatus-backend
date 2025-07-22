const express = require('express');
const router = express.Router();
const poolController = require('../controllers/poolController');
const reelController = require('../controllers/reelcontroller');

//-----------Reels controls-----------
//upload reel 
router.post('/:poolId/upload', reelController.uploadReels);

// RESTful route for fetching reels by poolId
router.get('/:poolId/reels', reelController.getReelsByPoolId);

// Delete a single reel
router.delete('/reels/:reelId', reelController.deleteReel);

// Delete multiple reels
router.delete('/reels', reelController.deleteMultipleReels);

// Delete all reels from a pool
router.delete('/:poolId/reels', reelController.deleteAllReelsFromPool);

//approved credits
router.post('/reels/approved/:campaignId', reelController.approveCreditsForUser);

// Route to get YouTube video stats
router.get('/stats', reelController.getYoutubeVideoStats);

//share reel algo
router.post('/shared', reelController.assignReelsToUsersWithCount);

// Fetch all shared reels for a user (by googleId)
router.get('/shared/:userId', reelController.getSharedReelsForUser);

// Route to update task completed status
router.post('/shared/complete/:userId/:reelId', reelController.updateTaskCompleted);

// Route to update task accepted status
router.post('/shared/accepted/:userId/:reelId', reelController.updateTaskAccepted);

// Add user response URL
router.post('/user/response/:userId', reelController.addUserResponseUrl);

//Get user response url
router.get('/user/response/get/:userId', reelController.getAddUserResponseUrl);

// ------------pool controls--------------

// Create a new pool
router.post('/', poolController.createPool);

// Get all pools
router.get('/', poolController.getPools);

// Get pool by id (must come before /:id to avoid conflicts)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await require('../models/pool').findById(id);
    if (!pool) {
      return res.status(404).json({ error: 'Pool not found' });
    }
    res.json({ pool });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pool', details: err.message });
  }
});

// Update pool by id
router.put('/:id', poolController.updatePool);

// Delete pool by id
router.delete('/:id', poolController.deletePool);


module.exports = router; 