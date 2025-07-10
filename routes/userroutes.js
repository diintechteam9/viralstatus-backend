const express = require('express');
const { loginUser, registerUser} = require('../controllers/usercontroller');
const router = express.Router();
const User = require('../models/user');

router.post('/login', loginUser);

router.post('/register', registerUser);

// GET /api/user/by-googleid/:googleId
router.get('/by-googleid/:googleId', async (req, res) => {
  try {
    const user = await User.findOne({ googleId: req.params.googleId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user: { name: user.name, googleId: user.googleId, email: user.email } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

module.exports = router;