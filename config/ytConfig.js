require('dotenv').config();
const { google } = require('googleapis');

const redirectUri = process.env.REDIRECT_URI || `${process.env.BACKEND_URL}/auth/youtube/callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  redirectUri
);

module.exports = { oauth2Client };
