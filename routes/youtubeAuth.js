const express = require('express');
const router = express.Router();
const { oauth2Client } = require('../config/ytConfig');

const REDIRECT_URI = process.env.REDIRECT_URI || `${process.env.BACKEND_URL}/auth/youtube/callback`;

// Route to initiate YouTube OAuth
router.get('/', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ],
    prompt: 'consent',
    redirect_uri: REDIRECT_URI,
  });

  res.redirect(authUrl);
});

// OAuth callback route with PKCE
router.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    console.error('No authorization code provided.');
    return res.redirect(`${process.env.FRONTEND_URL}/?error=no_code`);
  }

  try {
    const { tokens } = await oauth2Client.getToken({ code, redirect_uri: REDIRECT_URI });

    oauth2Client.setCredentials(tokens);
    req.session.tokens = tokens;

    res.redirect(`${process.env.FRONTEND_URL}/accounts?auth=success`);
  } catch (error) {
    console.error('OAuth Error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/?error=auth_failed`);
  }
});

// Disconnect YouTube account
router.post('/youtube/disconnect', async (req, res) => {
  try {
    // Get tokens from session
    const { tokens } = req.session;
    // Remove tokens from session
    delete req.session.tokens;

    if (tokens && tokens.access_token) {
      const { google } = require('googleapis');
      const auth = new google.auth.OAuth2();
      auth.setCredentials(tokens);
      try {
        await auth.revokeCredentials();
      } catch (err) {
        // Log but do not throw, as the session is already cleared
        console.error('Error revoking YouTube credentials:', err.message);
      }
    }

    res.json({ message: 'Successfully disconnected from YouTube' });
  } catch (error) {
    console.error('Error disconnecting YouTube:', error);
    res.status(500).json({ error: 'Failed to disconnect from YouTube' });
  }
});

// Get YouTube user profile
router.get('/youtube/profile', async (req, res) => {
  try {
    const { tokens } = req.session;
    if (!tokens) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const auth = new (require('googleapis').google.auth.OAuth2)();
    auth.setCredentials(tokens);
    const youtube = require('googleapis').google.youtube({ version: 'v3', auth });
    const response = await youtube.channels.list({
      part: 'snippet',
      mine: true,
    });
    const channel = response.data.items[0];
    if (!channel) {
      return res.status(404).json({ error: 'YouTube channel not found' });
    }
    res.json({
      name: channel.snippet.title,
      picture: channel.snippet.thumbnails.default.url,
      id: channel.id,
      username: channel.snippet.customUrl || channel.snippet.title,
    });
  } catch (error) {
    console.error('YouTube profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch YouTube profile' });
  }
});

module.exports = router;
