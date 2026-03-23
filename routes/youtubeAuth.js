const express = require('express');
const router = express.Router();
const { oauth2Client } = require('../config/ytConfig');
const { google } = require('googleapis');
const Account = require('../models/Account');

const REDIRECT_URI = process.env.REDIRECT_URI || `${process.env.BACKEND_URL}/auth/youtube/callback`;

// Initiate YouTube OAuth — userId passed as state from frontend
router.get('/', (req, res) => {
  const userId = req.query.userId || '';
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ],
    prompt: 'consent',
    redirect_uri: REDIRECT_URI,
    state: userId,
  });
  res.redirect(authUrl);
});

// OAuth callback — save tokens to DB
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
    }

    res.redirect(`${process.env.FRONTEND_URL}/accounts?auth=success`);
  } catch (error) {
    console.error('OAuth Error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/?error=auth_failed`);
  }
});

// Disconnect YouTube
router.post('/youtube/disconnect', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const account = await Account.findOne({ userId });
    const tokens = account?.youtubeTokens;

    if (tokens?.access_token) {
      const auth = new google.auth.OAuth2();
      auth.setCredentials(tokens);
      try { await auth.revokeCredentials(); } catch (_) {}
    }

    await Account.findOneAndUpdate({ userId }, { youtubeTokens: null });
    res.json({ message: 'Successfully disconnected from YouTube' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect from YouTube' });
  }
});

// Get YouTube profile
router.get('/youtube/profile', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const account = await Account.findOne({ userId });
    const tokens = account?.youtubeTokens;

    if (!tokens) return res.status(401).json({ error: 'Not authenticated' });

    const auth = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET
    );
    auth.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth });
    const response = await youtube.channels.list({ part: 'snippet', mine: true });
    const channel = response.data.items[0];
    if (!channel) return res.status(404).json({ error: 'YouTube channel not found' });

    res.json({
      name: channel.snippet.title,
      picture: channel.snippet.thumbnails.default.url,
      id: channel.id,
      username: channel.snippet.customUrl || channel.snippet.title,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch YouTube profile' });
  }
});

module.exports = router;
