const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { oauth2Client } = require('../config/ytConfig');

// Generate a random code verifier
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('hex');
}

// Generate code challenge from code verifier (SHA256 + base64-url)
function generateCodeChallenge(codeVerifier) {
  return crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Route to initiate YouTube OAuth with PKCE
router.get('/', (req, res) => {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Save codeVerifier in session for later use during token exchange
  req.session.codeVerifier = codeVerifier;

  const redirectUri = `${process.env.VITE_BACKEND_URL}/auth/youtube/callback`;
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ],
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri
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
    const codeVerifier = req.session.codeVerifier;
    if (!codeVerifier) {
      throw new Error('Missing code verifier in session.');
    }

    const redirectUri = `${process.env.VITE_BACKEND_URL}/auth/youtube/callback`;

    // Exchange code and codeVerifier for tokens
    const { tokens } = await oauth2Client.getToken({
      code,
      codeVerifier,
      redirect_uri: redirectUri,
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      grant_type: 'authorization_code',
    });

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
