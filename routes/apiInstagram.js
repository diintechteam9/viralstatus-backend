const express = require('express');
const InstagramAccount = require('../models/InstagramAccount');
const { protect } = require('../middleware/auth');
const router = express.Router();

function getUserId(req) {
  return (req.client?.id || req.user?.id || '').toString();
}

// GET /api/instagram/status
router.get('/status', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const account = await InstagramAccount.findOne({ userId });
    return res.json({
      connected: !!account,
      username:  account?.username || null,
      picture:   account?.profilePicture || null,
    });
  } catch (e) {
    return res.status(500).json({ connected: false, error: e.message });
  }
});

// DELETE /api/instagram/disconnect
router.delete('/disconnect', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    await InstagramAccount.deleteOne({ userId });
    console.log(`[IG] Disconnected for userId: ${userId}`);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
