const express = require('express');
const router = express.Router();
const { oauth2Client } = require('../config/ytConfig');
const { google } = require('googleapis');
const Account = require('../models/Account');

const REDIRECT_URI = process.env.REDIRECT_URI || `${process.env.BACKEND_URL}/auth/youtube/callback`;

// ── GET /auth/youtube — initiate OAuth ───────────────────────────────────────
// userId passed as query param from frontend, stored in OAuth state
router.get('/', (req, res) => {
  const userId = req.query.userId || '';
  if (!userId) {
    return res.redirect(`${process.env.FRONTEND_URL}/?error=missing_userId`);
  }
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
    prompt: 'consent',
    redirect_uri: REDIRECT_URI,
    state: userId,
  });
  res.redirect(authUrl);
});

// ── GET /auth/youtube/callback — OAuth callback, save tokens ─────────────────
router.get('/callback', async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}/?error=no_code`);
  }

  try {
    const { tokens } = await oauth2Client.getToken({ code, redirect_uri: REDIRECT_URI });
    oauth2Client.setCredentials(tokens);

    if (userId) {
      await Account.findOneAndUpdate(
        { userId },
        { userId, youtubeTokens: tokens, updatedAt: new Date() },
        { upsert: true, new: true }
      );
      console.log(`[YT Auth] Tokens saved for userId: ${userId}`);
    }

    res.redirect(`${process.env.FRONTEND_URL}/accounts?auth=success`);
  } catch (error) {
    console.error('[YT Auth] OAuth callback error:', error.message);
    res.redirect(`${process.env.FRONTEND_URL}/?error=auth_failed`);
  }
});

// ── POST /auth/youtube/disconnect — revoke & clear tokens ────────────────────
// Fixed: was '/youtube/disconnect' which made URL /auth/youtube/youtube/disconnect
router.post('/disconnect', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const account = await Account.findOne({ userId });
    const tokens = account?.youtubeTokens;

    if (tokens?.access_token) {
      try {
        const auth = new google.auth.OAuth2(
          process.env.YOUTUBE_CLIENT_ID,
          process.env.YOUTUBE_CLIENT_SECRET
        );
        auth.setCredentials(tokens);
        await auth.revokeCredentials();
        console.log(`[YT Auth] Tokens revoked for userId: ${userId}`);
      } catch (_) {
        // Non-fatal: still clear from DB
        console.warn('[YT Auth] Token revoke failed (non-fatal), clearing from DB anyway');
      }
    }

    await Account.findOneAndUpdate(
      { userId },
      { youtubeTokens: null, updatedAt: new Date() }
    );
    console.log(`[YT Auth] YouTube disconnected for userId: ${userId}`);
    return res.json({ success: true, message: 'Successfully disconnected from YouTube' });
  } catch (error) {
    console.error('[YT Auth] Disconnect error:', error.message);
    return res.status(500).json({ error: 'Failed to disconnect from YouTube' });
  }
});

// ── GET /auth/youtube/profile — fetch YouTube channel info ───────────────────
// Fixed: was '/youtube/profile' which made URL /auth/youtube/youtube/profile
router.get('/profile', async (req, res) => {
  try {
    const { userId } = req.query;

    // Support Authorization header as fallback
    let resolvedUserId = userId;
    if (!resolvedUserId) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
          resolvedUserId = decoded.id;
        } catch (_) {}
      }
    }

    if (!resolvedUserId) return res.status(400).json({ error: 'userId is required' });

    const account = await Account.findOne({ userId: resolvedUserId });
    const tokens = account?.youtubeTokens;
    if (!tokens) return res.status(401).json({ error: 'YouTube not connected', code: 'NOT_CONNECTED' });

    const auth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      REDIRECT_URI
    );
    auth.setCredentials(tokens);

    // Auto-persist refreshed tokens
    auth.on('tokens', async (newTokens) => {
      try {
        const merged = { ...tokens, ...newTokens };
        await Account.findOneAndUpdate(
          { userId: resolvedUserId },
          { youtubeTokens: merged, updatedAt: new Date() }
        );
        console.log(`[YT Auth] Tokens refreshed for userId: ${resolvedUserId}`);
      } catch (e) {
        console.error('[YT Auth] Failed to persist refreshed tokens:', e.message);
      }
    });

    const youtube = google.youtube({ version: 'v3', auth });
    const response = await youtube.channels.list({ part: 'snippet', mine: true });
    const channel = response.data.items?.[0];
    if (!channel) return res.status(404).json({ error: 'YouTube channel not found' });

    return res.json({
      name:     channel.snippet.title,
      picture:  channel.snippet.thumbnails?.default?.url || '',
      id:       channel.id,
      username: channel.snippet.customUrl || channel.snippet.title,
    });
  } catch (error) {
    console.error('[YT Auth] Profile fetch error:', error.message);

    // Token expired / revoked
    if (error.code === 401 || error.message?.includes('invalid_grant')) {
      const { userId } = req.query;
      if (userId) {
        await Account.findOneAndUpdate({ userId }, { youtubeTokens: null }).catch(() => {});
      }
      return res.status(401).json({ error: 'YouTube session expired. Please reconnect.', code: 'NOT_CONNECTED' });
    }
    return res.status(500).json({ error: 'Failed to fetch YouTube profile' });
  }
});

module.exports = router;
