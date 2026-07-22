const axios = require('axios');
const http = require('http');
const url = require('url');

const GOOGLE_CLIENT_ID = '635888438775-6bi5aok4nlm0hfjt7nv7a4ktudsgis1d.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const REDIRECT_URI = 'http://localhost:3000/callback';

async function getGoogleTokenAndTest() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 GETTING REAL GOOGLE TOKEN FOR vijay.wiz@gmail.com');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Step 1: Generate authorization URL
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
      `response_type=code&` +
      `scope=openid%20email%20profile&` +
      `login_hint=vijay.wiz@gmail.com&` +
      `access_type=offline`;

    console.log('📝 Step 1: Authorization URL Generated\n');
    console.log('Open this URL in your browser:\n');
    console.log(authUrl + '\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 MANUAL STEPS TO GET TOKEN:\n');
    console.log('1. Copy the URL above and open in browser');
    console.log('2. Sign in with vijay.wiz@gmail.com');
    console.log('3. Grant permissions');
    console.log('4. You\'ll be redirected to localhost');
    console.log('5. Copy the "code" parameter from the URL\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔗 ALTERNATIVE: Use Google OAuth Playground\n');
    console.log('This is the EASIEST way:\n');
    console.log('1. Go to: https://developers.google.com/oauthplayground');
    console.log('2. Click ⚙️ (settings) in top right');
    console.log('3. Check "Use your own OAuth credentials"');
    console.log('4. Enter Client ID: ' + GOOGLE_CLIENT_ID);
    console.log('5. Enter Client Secret: ' + GOOGLE_CLIENT_SECRET);
    console.log('6. Close settings');
    console.log('7. In left panel, find "Google OAuth 2.0 API v2"');
    console.log('8. Select both scopes:');
    console.log('   - https://www.googleapis.com/auth/userinfo.profile');
    console.log('   - https://www.googleapis.com/auth/userinfo.email');
    console.log('9. Click "Authorize APIs"');
    console.log('10. Sign in with vijay.wiz@gmail.com');
    console.log('11. Grant permissions');
    console.log('12. Click "Exchange authorization code for tokens"');
    console.log('13. Copy the "id_token" value\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📝 POSTMAN TEST (After getting token):\n');
    console.log('URL: https://yovoaiapi.diintech.com/api/auth/google/verify\n');
    console.log('Method: POST\n');
    console.log('Headers:');
    console.log('  Content-Type: application/json\n');
    console.log('Body (raw JSON):');
    console.log('{');
    console.log('  "googleToken": "PASTE_YOUR_ID_TOKEN_HERE"');
    console.log('}\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ EXPECTED RESPONSE:\n');
    console.log(JSON.stringify({
      success: true,
      message: "Verified successfully",
      authToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      MongoId: "507f1f77bcf86cd799439011",
      isClient: false,
      email: "vijay.wiz@gmail.com",
      name: "Vijay Wiz",
      emailVerified: true,
      isProfileCompleted: false,
      googleId: "123456789012345678901"
    }, null, 2));

    console.log('\n═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

getGoogleTokenAndTest();
