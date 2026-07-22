const axios = require('axios');
const http = require('http');
const url = require('url');

const FIREBASE_API_KEY = 'AIzaSyADiUc4XZo4hz6qnZm4b0YFsQzTFDKEBYQ';
const GOOGLE_CLIENT_ID = '635888438775-6bi5aok4nlm0hfjt7nv7a4ktudsgis1d.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';

async function getGoogleToken() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 GETTING REAL GOOGLE TOKEN FOR vijay.wiz@gmail.com');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('⚠️  Firebase has these restrictions:');
    console.log('  ❌ Password login: DISABLED');
    console.log('  ❌ Anonymous sign-in: DISABLED');
    console.log('  ✅ Google OAuth: ENABLED\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 TO GET A REAL TOKEN:\n');

    console.log('OPTION 1: Using Google OAuth Playground (EASIEST)\n');
    console.log('─────────────────────────────────────────────────────────\n');
    console.log('1. Go to: https://developers.google.com/oauthplayground\n');
    console.log('2. Click ⚙️ (settings) in top right\n');
    console.log('3. Check "Use your own OAuth credentials"\n');
    console.log('4. Enter:');
    console.log('   Client ID: ' + GOOGLE_CLIENT_ID);
    console.log('   Client Secret: ' + GOOGLE_CLIENT_SECRET + '\n');
    console.log('5. Close settings\n');
    console.log('6. In left panel, find "Google OAuth 2.0 API v2"\n');
    console.log('7. Select both scopes:');
    console.log('   ✓ https://www.googleapis.com/auth/userinfo.profile');
    console.log('   ✓ https://www.googleapis.com/auth/userinfo.email\n');
    console.log('8. Click "Authorize APIs"\n');
    console.log('9. Sign in with: vijay.wiz@gmail.com\n');
    console.log('10. Grant permissions\n');
    console.log('11. Click "Exchange authorization code for tokens"\n');
    console.log('12. Copy the "id_token" value\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('OPTION 2: Using Direct Google OAuth URL\n');
    console.log('─────────────────────────────────────────────────────────\n');

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID}&` +
      `redirect_uri=http://localhost:3000/callback&` +
      `response_type=code&` +
      `scope=openid%20email%20profile&` +
      `login_hint=vijay.wiz@gmail.com`;

    console.log('1. Open this URL in browser:\n');
    console.log(authUrl + '\n');
    console.log('2. Sign in with vijay.wiz@gmail.com\n');
    console.log('3. Grant permissions\n');
    console.log('4. You\'ll be redirected to localhost with a "code" parameter\n');
    console.log('5. Copy the code\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('OPTION 3: From Flutter App (PRODUCTION METHOD)\n');
    console.log('─────────────────────────────────────────────────────────\n');
    console.log('import \'package:google_sign_in/google_sign_in.dart\';');
    console.log('import \'package:firebase_auth/firebase_auth.dart\';\n');
    console.log('final GoogleSignInAccount? googleUser = await GoogleSignIn().signIn();');
    console.log('final GoogleSignInAuthentication? googleAuth = await googleUser?.authentication;');
    console.log('final String? idToken = googleAuth?.idToken;\n');
    console.log('print(idToken); // Use this token\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ POSTMAN REQUEST (After getting token)\n');
    console.log('─────────────────────────────────────────────────────────\n');
    console.log('Method: POST\n');
    console.log('URL:');
    console.log('https://yovoaiapi.diintech.com/api/auth/google/verify\n');
    console.log('Headers:');
    console.log('Content-Type: application/json\n');
    console.log('Body (raw JSON):');
    console.log('{');
    console.log('  "googleToken": "PASTE_YOUR_ID_TOKEN_HERE"');
    console.log('}\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎯 RECOMMENDED: Use Google OAuth Playground\n');
    console.log('It\'s the easiest and fastest way to get a real token!\n');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

getGoogleToken();
