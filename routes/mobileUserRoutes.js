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
  uploadProfileImage,
  getProfileImageUploadUrl,
  confirmProfileImage,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  resendResetOtp,
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

// Profile Image Upload - R2 (protected)
// Route 1: Direct upload - multipart/form-data (Postman/Mobile ke liye)
router.post('/profile/image', protect, uploadProfileImage);
// Route 2: Get presigned URL (Web frontend ke liye)
router.post('/profile/image/upload-url', protect, getProfileImageUploadUrl);
// Route 3: After uploading to R2 via presigned URL, confirm key
router.post('/profile/image/confirm', protect, confirmProfileImage);

// Forgot Password Flow
router.post('/forgot-password', forgotPassword);
router.post('/forgot-password/verify-otp', verifyResetOtp);
router.post('/forgot-password/reset', resetPassword);
router.post('/forgot-password/resend-otp', resendResetOtp);

module.exports = router;
