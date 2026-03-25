const express = require('express');
const axios = require('axios');
const InstagramAccount = require('../models/InstagramAccount');
const router = express.Router();

// GET /auth/instagram/callback
router.get('/callback', async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code) return res.redirect(`${process.env.FRONTEND_URL}/?error=no_code`);
  if (!userId) return res.redirect(`${process.env.FRONTEND_URL}/?error=missing_userId`);

  try {
    // Step 1: Short-lived FB token
    const tokenRes = await axios.get('https://graph.facebook.com/v15.0/oauth/access_token', {
      params: {
        client_id:     process.env.VITE_FB_APP_ID,
        redirect_uri:  process.env.VITE_FB_REDIRECT_URI,
        client_secret: process.env.VITE_FB_APP_SECRET,
        code,
      },
    });
    const fbAccessToken = tokenRes.data.access_token;

    // Step 2: Long-lived token
    const longRes = await axios.get('https://graph.facebook.com/v15.0/oauth/access_token', {
      params: {
        grant_type:        'fb_exchange_token',
        client_id:         process.env.VITE_FB_APP_ID,
        client_secret:     process.env.VITE_FB_APP_SECRET,
        fb_exchange_token: fbAccessToken,
      },
    });
    const longLivedToken = longRes.data.access_token;

    // Step 3: FB Pages
    const pagesRes = await axios.get('https://graph.facebook.com/v15.0/me/accounts', {
      params: { access_token: longLivedToken, fields: 'instagram_business_account,access_token,name' },
    });
    const page = pagesRes.data.data?.[0];
    if (!page) throw new Error('No managed Facebook pages found');

    // Step 4: Instagram Business Account ID
    const igAccountRes = await axios.get(`https://graph.facebook.com/v15.0/${page.id}`, {
      params: { fields: 'instagram_business_account', access_token: page.access_token },
    });
    const igUserId = igAccountRes.data.instagram_business_account?.id;
    if (!igUserId) throw new Error('No Instagram Business account linked to this page');

    // Step 5: Instagram profile
    const igUserRes = await axios.get(`https://graph.facebook.com/v15.0/${igUserId}`, {
      params: { fields: 'username,profile_picture_url', access_token: page.access_token },
    });

    // Save to DB — keyed by userId (MongoDB client _id)
    await InstagramAccount.findOneAndUpdate(
      { userId },
      {
        userId,
        instagramId:    igUserId,
        username:       igUserRes.data.username,
        profilePicture: igUserRes.data.profile_picture_url,
        accessToken:    page.access_token,
        pageId:         page.id,
        pageName:       page.name,
        connectedAt:    new Date(),
      },
      { upsert: true, new: true }
    );

    console.log(`[IG Auth] Connected for userId: ${userId} → @${igUserRes.data.username}`);
    res.redirect(`${process.env.FRONTEND_URL}/accounts?instagram=success`);
  } catch (error) {
    console.error('[IG Auth] Callback error:', error.message);
    res.redirect(`${process.env.FRONTEND_URL}/?error=instagram_auth_failed`);
  }
});

module.exports = router;
