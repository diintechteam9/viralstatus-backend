const express = require('express');
const { loginUser, registerUser} = require('../controllers/usercontroller');
const router = express.Router();
const User = require('../models/user');
const MobileUser = require('../models/MobileUser');
const { getParticipantInsights } = require('../controllers/participantInsightsController');

router.post('/login', loginUser);

router.post('/register', registerUser);

// GET /api/user/participant-insights/:googleId?campaignId=...
router.get('/participant-insights/:googleId', getParticipantInsights);

// GET /api/user/by-googleid/:googleId — googleId OR MongoDB _id se dhundho
router.get('/by-googleid/:googleId', async (req, res) => {
  try {
    const { googleId } = req.params;
    const mongoose = require('mongoose');

    // Try googleId first
    let mobile = await MobileUser.findOne({ googleId }).select(
      '-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry -resetOtp -resetOtpExpiry'
    );

    // Fallback: try MongoDB _id
    if (!mobile && mongoose.Types.ObjectId.isValid(googleId)) {
      mobile = await MobileUser.findById(googleId).select(
        '-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry -resetOtp -resetOtpExpiry'
      );
    }

    // Try web User
    if (!mobile) {
      const webUser = await User.findOne({ googleId });
      if (webUser) {
        return res.json({
          success: true,
          user: { name: webUser.name, googleId: webUser.googleId, email: webUser.email },
        });
      }
    }

    if (!mobile) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const u = mobile.toObject();
    res.json({ success: true, user: { ...u, mobileNumber: u.mobileNumber || u.mobile } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

module.exports = router;