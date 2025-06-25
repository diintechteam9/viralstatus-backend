const express = require('express');
const axios = require('axios');
const InstagramAccount = require('../models/InstagramAccount');
const router = express.Router();

const authenticateUser = (req, res, next) => {
  // For now, we'll use a default user ID since we don't have full auth
  req.user = { _id: 'default_user' };
  next();
};

router.get('/callback', authenticateUser, async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('No code provided');
  }

  try {
    console.log('Instagram callback received. Code:', code);
    // Step 1: Exchange code for Facebook user access token
    const tokenRes = await axios.get('https://graph.facebook.com/v15.0/oauth/access_token', {
      params: {
        client_id: process.env.VITE_FB_APP_ID,
        redirect_uri: process.env.VITE_FB_REDIRECT_URI,
        client_secret: process.env.VITE_FB_APP_SECRET,
        code,
      },
    });
    const fbAccessToken = tokenRes.data.access_token;
    console.log('Step 1 successful: Got FB Access Token.');

    // Step 2: Get long-lived access token
    const longLivedTokenRes = await axios.get('https://graph.facebook.com/v15.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: process.env.VITE_FB_APP_ID,
        client_secret: process.env.VITE_FB_APP_SECRET,
        fb_exchange_token: fbAccessToken,
      },
    });
    const longLivedToken = longLivedTokenRes.data.access_token;
    console.log('Step 2 successful: Got Long-Lived Token.');

    // Step 3: Get Facebook Pages the user manages
    const pagesRes = await axios.get('https://graph.facebook.com/v15.0/me/accounts', {
      params: { 
        access_token: longLivedToken,
        fields: 'instagram_business_account,access_token,name'
      },
    });

    const page = pagesRes.data.data[0]; // pick first page
    if (!page) {
      console.error('No managed pages found for user.');
      throw new Error('No managed pages found for user');
    }
    const pageId = page.id;
    const pageAccessToken = page.access_token;
    console.log('Step 3 successful: Got Page ID and Page Access Token.');

    // Step 4: Get Instagram Business Account ID linked to the Page
    const igAccountRes = await axios.get(`https://graph.facebook.com/v15.0/${pageId}`, {
      params: {
        fields: 'instagram_business_account',
        access_token: pageAccessToken,
      },
    });

    const igUserId = igAccountRes.data.instagram_business_account?.id;
    if (!igUserId) {
      console.error('Instagram account not linked to the page.');
      throw new Error('Instagram account not linked to the page');
    }
    console.log('Step 4 successful: Got Instagram User ID:', igUserId);

    // Step 5: Get Instagram user profile
    const igUserRes = await axios.get(`https://graph.facebook.com/v15.0/${igUserId}`, {
      params: {
        fields: 'username,profile_picture_url',
        access_token: pageAccessToken,
      },
    });
    const igData = igUserRes.data;
    console.log('Step 5 successful: Got Instagram User Profile:', igData);

    // Save to DB
    try {
      const updatedAccount = await InstagramAccount.findOneAndUpdate(
      { userId: req.user._id },
      {
        userId: req.user._id,
        instagramId: igUserId,
        username: igData.username,
        profilePicture: igData.profile_picture_url,
        accessToken: pageAccessToken,
          pageId: pageId,
          pageName: page.name,
        connectedAt: new Date(),
      },
      { upsert: true, new: true }
    );
    console.log('Database update successful.');
    } catch (dbError) {
      console.error('Failed to save Instagram account to database:', dbError);
      throw new Error('Failed to save Instagram account to database');
    }

    // Redirect to frontend with success
    const redirectUrl = `${process.env.FRONTEND_URL}/accounts?instagram=success&userId=${igUserId}`;
    console.log('Redirecting to frontend with success:', redirectUrl);
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Error in Instagram auth callback:', error.message);
    if (error.response) {
      console.error('Error details:', error.response.data);
    }
    const errorRedirectUrl = `${process.env.FRONTEND_URL}/accounts?error=instagram_auth_failed`;
    console.log('Redirecting to frontend with error:', errorRedirectUrl);
    res.redirect(errorRedirectUrl);
  }
});

module.exports = router;
