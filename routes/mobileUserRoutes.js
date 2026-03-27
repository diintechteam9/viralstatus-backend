const express = require('express');
const router = express.Router();
const {
  step1SendEmailOtp,
  step1VerifyEmailOtp,
  step2SendMobileOtp,
  step2VerifyMobileOtp,
  step3CompleteProfile,
  loginUser,
  googleAuth,
  checkEmail,
  resendEmailOtp,
  resendMobileOtp,
  firebaseRegister,
  firebaseLogin,
  getProfile,
  updateProfile,
} = require('../controllers/mobileUserController');

const { protect } = require('../middleware/mobileAuth');

// Registration Steps
router.post('/register/step1', step1SendEmailOtp);
router.post('/register/step1/verify', step1VerifyEmailOtp);
router.post('/register/step2', step2SendMobileOtp);
router.post('/register/step2/verify', step2VerifyMobileOtp);
router.post('/register/step3', step3CompleteProfile);

// Login
router.post('/login', loginUser);

// Google Auth
router.post('/register/google', googleAuth);

// Check Email
router.post('/check-email', checkEmail);

// Resend OTPs
router.post('/register/resend-email-otp', resendEmailOtp);
router.post('/register/resend-mobile-otp', resendMobileOtp);

// Firebase Auth
router.post('/register/firebase', firebaseRegister);
router.post('/login/firebase', firebaseLogin);

// Profile (protected)
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);

module.exports = router;
