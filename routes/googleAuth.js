const express = require('express');
const router = express.Router();
const { verifyGoogleToken, verifyJWTToken } = require('../middleware/googleAuth');
const {
  verifyUser,
  completeProfile,
  getProfile,
  updateProfile
} = require('../controllers/googleAuthController');

/**
 * @route   POST /api/auth/google/verify
 * @desc    Verify Google user and create/update account
 * @access  Public
 * 
 * Request body:
 * {
 *   "googleToken": "google_id_token_from_flutter_app"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "User verified successfully",
 *   "token": "jwt_token",
 *   "user": {
 *     "_id": "user_id",
 *     "name": "User Name",
 *     "email": "user@example.com",
 *     "googlePicture": "profile_picture_url",
 *     "isGoogleUser": true,
 *     "emailVerified": true,
 *     "profileCompleted": false,
 *     "businessName": null,
 *     "gstNo": null,
 *     "panNo": null,
 *     "aadharNo": null,
 *     "city": null,
 *     "pincode": null,
 *     "websiteUrl": null,
 *     "createdAt": "2024-01-01T00:00:00.000Z",
 *     "lastLoginAt": "2024-01-01T00:00:00.000Z"
 *   }
 * }
 */
router.post('/verify', verifyGoogleToken, verifyUser);

/**
 * @route   GET /api/auth/google/test
 * @desc    Test endpoint to check if the route is working
 * @access  Public
 */
router.get('/test', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Google Auth API is working!',
    endpoints: {
      verify: 'POST /api/auth/google/verify',
      completeProfile: 'POST /api/auth/google/complete-profile',
      getProfile: 'GET /api/auth/google/profile',
      updateProfile: 'PUT /api/auth/google/profile'
    },
    instructions: 'Use POST /api/auth/google/verify with googleToken in body to test the main functionality',
    sampleTokenStructure: {
      iss: 'https://accounts.google.com',
      azp: 'your-client-id.apps.googleusercontent.com',
      aud: 'your-client-id.apps.googleusercontent.com',
      sub: 'user-google-id',
      email: 'user@example.com',
      email_verified: true,
      name: 'User Name',
      picture: 'profile-picture-url',
      given_name: 'First Name',
      family_name: 'Last Name'
    }
  });
});

/**
 * @route   POST /api/auth/google/complete-profile
 * @desc    Complete profile for Google users (add business information)
 * @access  Private (requires JWT token)
 * 
 * Request body:
 * {
 *   "businessName": "Business Name",
 *   "gstNo": "GST123456789",
 *   "panNo": "ABCDE1234F",
 *   "aadharNo": "123456789012",
 *   "city": "Mumbai",
 *   "pincode": "400001",
 *   "websiteUrl": "https://example.com" (optional)
 * }
 */
router.post('/complete-profile', verifyJWTToken, completeProfile);

/**
 * @route   GET /api/auth/google/profile
 * @desc    Get current user profile
 * @access  Private (requires JWT token)
 */
router.get('/profile', verifyJWTToken, getProfile);

/**
 * @route   PUT /api/auth/google/profile
 * @desc    Update user profile information
 * @access  Private (requires JWT token)
 * 
 * Request body: (any fields to update)
 * {
 *   "name": "Updated Name",
 *   "businessName": "Updated Business Name",
 *   "city": "Updated City"
 * }
 */
router.put('/profile', verifyJWTToken, updateProfile);

module.exports = router; 