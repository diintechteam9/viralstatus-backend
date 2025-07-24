const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  createUserProfile,
  getAllUserProfiles,
  getUserProfileById,
  getUserProfileByEmail,
  getCurrentUserProfile,
  updateUserProfile,
  deleteUserProfile,
  verifyUserProfile,
  getProfileStats
} = require('../controllers/userProfileController');
const { verifyToken } = require('../middleware/authmiddleware');

/**
 * @route   POST /api/user-profiles
 * @desc    Create a new user profile
 * @access  Private (requires authentication)
 * 
 * Request body:
 * {
 *   "name": "John Doe",
 *   "email": "john@example.com",
 *   "mobileNumber": "+1234567890",
 *   "city": "Mumbai",
 *   "pincode": "400001",
 *   "businessName": "John's Business",
 *   "gender": "Male",
 *   "ageRange": "25-34",
 *   "businessInterests": ["Fashion & Lifestyle", "Beauty & Cosmetics"],
 *   "otherBusinessInterest": "Custom interest",
 *   "occupation": "Content Creator (Full-Time)",
 *   "highestQualification": "Bachelor's Degree",
 *   "fieldOfStudy": "Computer Science",
 *   "skills": ["Content Creation", "Video Editing"],
 *   "otherSkills": "Custom skills",
 *   "socialMedia": {
 *     "instagram": {
 *       "handle": "@johndoe",
 *       "followersCount": 10000
 *     },
 *     "youtube": {
 *       "channelUrl": "https://youtube.com/@johndoe",
 *       "subscribers": 5000
 *     }
 *   }
 * }
 * 
 * Note: name, email, city, pincode, and businessName are auto-populated from client data and cannot be edited.
 */
router.post('/', protect, createUserProfile);

/**
 * @route   GET /api/user-profiles
 * @desc    Get all user profiles with filtering and pagination
 * @access  Public
 * 
 * Query parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10)
 * - city: Filter by city
 * - businessInterests: Filter by business interests (comma-separated)
 * - occupation: Filter by occupation
 * - isVerified: Filter by verification status (true/false)
 * - isActive: Filter by active status (true/false)
 * - search: Search in name, email, city
 * 
 * Example: GET /api/user-profiles?page=1&limit=10&city=Mumbai&isVerified=true
 */
router.get('/', getAllUserProfiles);

/**
 * @route   GET /api/user-profiles/stats
 * @desc    Get user profile statistics
 * @access  Public
 * 
 * Response:
 * {
 *   "success": true,
 *   "stats": {
 *     "totalProfiles": 100,
 *     "verifiedProfiles": 75,
 *     "activeProfiles": 90,
 *     "completedProfiles": 85,
 *     "verificationRate": "75.00",
 *     "completionRate": "85.00"
 *   },
 *   "topCities": [...],
 *   "topBusinessInterests": [...],
 *   "topOccupations": [...]
 * }
 */
router.get('/stats', getProfileStats);

/**
 * @route   GET /api/user-profiles/me
 * @desc    Get current user's profile
 * @access  Private (requires authentication)
 * 
 * Response:
 * {
 *   "success": true,
 *   "userProfile": { ... }
 * }
 */
router.get('/me', protect, getCurrentUserProfile);

/**
 * @route   GET /api/user-profiles/email/:email
 * @desc    Get user profile by email
 * @access  Public
 * 
 * Example: GET /api/user-profiles/email/john@example.com
 */
router.get('/email/:email', getUserProfileByEmail);

/**
 * @route   GET /api/user-profiles/:id
 * @desc    Get user profile by ID
 * @access  Public
 * 
 * Example: GET /api/user-profiles/507f1f77bcf86cd799439011
 */
router.get('/:id', getUserProfileById);

/**
 * @route   PUT /api/user-profiles/:id
 * @desc    Update user profile
 * @access  Private (requires authentication)
 * 
 * Request body: Any fields to update
 * Example: PUT /api/user-profiles/507f1f77bcf86cd799439011
 */
router.put('/update', protect ,verifyToken, updateUserProfile);

/**
 * @route   DELETE /api/user-profiles/:id
 * @desc    Delete user profile
 * @access  Public
 * 
 * Example: DELETE /api/user-profiles/507f1f77bcf86cd799439011
 */
router.delete('/:id', deleteUserProfile);

/**
 * @route   PATCH /api/user-profiles/:id/verify
 * @desc    Verify/unverify user profile (admin function)
 * @access  Public
 * 
 * Request body:
 * {
 *   "isVerified": true
 * }
 * 
 * Example: PATCH /api/user-profiles/507f1f77bcf86cd799439011/verify
 */
router.patch('/:id/verify', verifyUserProfile);

module.exports = router; 