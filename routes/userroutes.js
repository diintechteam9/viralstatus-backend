const express = require('express');
const { loginUser, registerUser} = require('../controllers/usercontroller');
const router = express.Router();
const User = require('../models/user');
const MobileUser = require('../models/MobileUser');

router.post('/login', loginUser);

router.post('/register', registerUser);

// GET /api/user/by-googleid/:googleId — web User first, then MobileUser (campaign participants)
router.get('/by-googleid/:googleId', async (req, res) => {
  try {
    const { googleId } = req.params;
    const webUser = await User.findOne({ googleId });
    if (webUser) {
      return res.json({
        success: true,
        user: { name: webUser.name, googleId: webUser.googleId, email: webUser.email },
      });
    }
    const mobile = await MobileUser.findOne({ googleId }).select(
      '-password -emailOtp -emailOtpExpiry -mobileOtp -mobileOtpExpiry -resetOtp -resetOtpExpiry'
    );
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