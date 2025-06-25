const express = require('express');
const InstagramAccount = require('../models/InstagramAccount');
const router = express.Router();

// Proper authentication middleware
const authenticateUser = (req, res, next) => {
  // For now, we'll use a default user ID since we don't have full auth
  req.user = { _id: 'default_user' };
  next();
};

// Get Instagram info by Instagram user ID (passed as query param)
router.get('/instagram', authenticateUser, async (req, res) => {
  try {
    console.log('🔍 Fetching Instagram account for user:', req.user._id);
    const instagramAccount = await InstagramAccount.findOne({ userId: req.user._id });
    
    if (!instagramAccount) {
      console.log('❌ No Instagram account found for user:', req.user._id);
      return res.status(404).json({ message: 'No Instagram account found' });
    }
    
    console.log('✅ Found Instagram account:', instagramAccount.username);
    res.json(instagramAccount);
  } catch (err) {
    console.error('❌ Error fetching Instagram account:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Disconnect Instagram account
router.delete('/instagram', authenticateUser, async (req, res) => {
  const instaUserId = req.body.instaUserId;
  if (!instaUserId) {
    console.log('❌ Missing Instagram User ID in disconnect request');
    return res.status(400).json({ message: 'Missing Instagram User ID' });
  }

  try {
    console.log('🔄 Disconnecting Instagram account:', instaUserId);
    const result = await InstagramAccount.deleteOne({ 
      userId: req.user._id,
      instagramId: instaUserId 
    });
    
    if (result.deletedCount === 0) {
      console.log('❌ No Instagram account found to disconnect');
      return res.status(404).json({ message: 'Instagram account not found' });
    }
    
    console.log('✅ Successfully disconnected Instagram account');
    res.json({ message: 'Instagram disconnected' });
  } catch (err) {
    console.error('❌ Error disconnecting Instagram account:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
