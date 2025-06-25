require('dotenv').config();
const { google } = require('googleapis');

const redirectUri = `${process.env.VITE_BACKEND_URL}/auth/callback`;

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  redirectUri
);

module.exports = { oauth2Client };
