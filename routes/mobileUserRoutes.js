const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  getMobileAppConfig,
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
  getProfileImageReadUrl,
  confirmProfileImage,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  resendResetOtp,
  updateUserLocation,
  getUserLocation,
} = require('../controllers/mobileUserController');

const { protect } = require('../middleware/mobileAuth');

// Multer - route level pe (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Allowed: jpeg, png, webp'), false);
  },
});

// App config (public) — default CLI code for Flutter / mobile
router.get('/app-config', getMobileAppConfig);

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

// Location — call when user opens app (after login, with GPS permission)
router.post('/location', protect, updateUserLocation);
router.get('/location', protect, getUserLocation);

// Profile Image Upload - R2 (protected)
// Route 1: Direct upload - multipart/form-data
router.post('/profile/image', protect, upload.single('image'), uploadProfileImage);
// Route 2: Presigned PUT URL (upload only — not for viewing)
router.post('/profile/image/upload-url', protect, getProfileImageUploadUrl);
// Route 3: Presigned GET URL for current user's stored profile image
router.get('/profile/image/read-url', protect, getProfileImageReadUrl);
// Route 4: Confirm key after R2 upload
router.post('/profile/image/confirm', protect, confirmProfileImage);

// Social Media Real Stats
router.get('/profile/social-stats', protect, async (req, res) => {
  try {
    const MobileUser = require('../models/MobileUser');
    const axios = require('axios');

    const user = await MobileUser.findById(req.user.id).select('socialMedia');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const result = { instagram: null, youtube: null };

    // ── YouTube real subscribers ──────────────────────────────────────────────
    const channelUrl = user.socialMedia?.youtube?.channelUrl;
    if (channelUrl && process.env.YOUTUBE_API_KEY) {
      try {
        let channelId = null;
        const handleMatch = channelUrl.match(/youtube\.com\/@([\w-]+)/);
        const channelIdMatch = channelUrl.match(/youtube\.com\/channel\/(UC[\w-]+)/);
        const customMatch = channelUrl.match(/youtube\.com\/c\/([\w-]+)/);

        if (channelIdMatch) {
          channelId = channelIdMatch[1];
        } else if (handleMatch || customMatch) {
          const handle = handleMatch ? handleMatch[1] : customMatch[1];
          const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
            params: { part: 'statistics,snippet', forHandle: handle, key: process.env.YOUTUBE_API_KEY },
          });
          const item = searchRes.data.items?.[0];
          if (item) {
            result.youtube = {
              subscribers: parseInt(item.statistics?.subscriberCount || 0),
              videoCount: parseInt(item.statistics?.videoCount || 0),
              viewCount: parseInt(item.statistics?.viewCount || 0),
              channelName: item.snippet?.title || '',
              thumbnail: item.snippet?.thumbnails?.default?.url || '',
            };
          }
        }

        if (channelId && !result.youtube) {
          const statsRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
            params: { part: 'statistics,snippet', id: channelId, key: process.env.YOUTUBE_API_KEY },
          });
          const item = statsRes.data.items?.[0];
          if (item) {
            result.youtube = {
              subscribers: parseInt(item.statistics?.subscriberCount || 0),
              videoCount: parseInt(item.statistics?.videoCount || 0),
              viewCount: parseInt(item.statistics?.viewCount || 0),
              channelName: item.snippet?.title || '',
              thumbnail: item.snippet?.thumbnails?.default?.url || '',
            };
          }
        }
      } catch (ytErr) {
        console.error('YouTube stats fetch error:', ytErr.message);
      }
    }

    // ── Instagram: scrape public profile page ────────────────────────────────
    const igHandle = user.socialMedia?.instagram?.handle?.replace('@', '').trim();
    if (igHandle) {
      try {
        // Method 1: Instagram i/api/v1 endpoint (works for public profiles)
        const igRes = await axios.get(
          `https://www.instagram.com/api/v1/users/web_profile_info/?username=${igHandle}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*',
              'Accept-Language': 'en-US,en;q=0.9',
              'X-IG-App-ID': '936619743392459',
              'X-Requested-With': 'XMLHttpRequest',
              'Referer': `https://www.instagram.com/${igHandle}/`,
              'Origin': 'https://www.instagram.com',
            },
            timeout: 8000,
          }
        );
        const igUser = igRes.data?.data?.user;
        if (igUser) {
          result.instagram = {
            followers: igUser.edge_followed_by?.count ?? null,
            following: igUser.edge_follow?.count ?? null,
            posts: igUser.edge_owner_to_timeline_media?.count ?? null,
            fullName: igUser.full_name || '',
            profilePic: igUser.profile_pic_url || '',
            isVerified: igUser.is_verified || false,
            biography: igUser.biography || '',
            live: true,
          };
          // Save fresh followers to DB
          if (result.instagram.followers !== null) {
            await MobileUser.findByIdAndUpdate(req.user.id, {
              'socialMedia.instagram.followersCount': String(result.instagram.followers),
            });
          }
        }
      } catch (igErr) {
        console.error('Instagram fetch error:', igErr.message);
        // Fallback: return stored value
        result.instagram = {
          followers: user.socialMedia?.instagram?.followersCount || null,
          live: false,
        };
      }
    } else {
      result.instagram = { followers: user.socialMedia?.instagram?.followersCount || null, live: false };
    }

    // Save fresh YouTube subscribers back to DB if fetched
    if (result.youtube?.subscribers !== undefined) {
      await MobileUser.findByIdAndUpdate(req.user.id, {
        'socialMedia.youtube.subscribers': String(result.youtube.subscribers),
      });
    }

    res.json({ success: true, stats: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Forgot Password Flow
router.post('/forgot-password', forgotPassword);
router.post('/forgot-password/verify-otp', verifyResetOtp);
router.post('/forgot-password/reset', resetPassword);
router.post('/forgot-password/resend-otp', resendResetOtp);

module.exports = router;
