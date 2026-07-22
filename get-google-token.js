const GOOGLE_CLIENT_ID = '635888438775-6bi5aok4nlm0hfjt7nv7a4ktudsgis1d.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const REDIRECT_URI = 'http://localhost:3000/callback';

console.log('═══════════════════════════════════════════════════════════');
console.log('🚀 GETTING REAL GOOGLE TOKEN FOR vijay.wiz@gmail.com');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('📋 METHOD 1: Using Google OAuth Playground (EASIEST)\n');
console.log('─────────────────────────────────────────────────────\n');
console.log('1. Go to: https://developers.google.com/oauthplayground\n');
console.log('2. Click settings icon (⚙️) in top right corner\n');
console.log('3. Check "Use your own OAuth credentials"\n');
console.log('4. Enter these credentials:');
console.log('   Client ID: ' + GOOGLE_CLIENT_ID);
console.log('   Client Secret: ' + GOOGLE_CLIENT_SECRET + '\n');
console.log('5. Close settings\n');
console.log('6. In left panel, scroll down and find "Google OAuth 2.0 API v2"\n');
console.log('7. Expand it and select:');
console.log('   ✓ https://www.googleapis.com/auth/userinfo.profile');
console.log('   ✓ https://www.googleapis.com/auth/userinfo.email\n');
console.log('8. Click "Authorize APIs" button\n');
console.log('9. Sign in with: vijay.wiz@gmail.com\n');
console.log('10. Grant permissions\n');
console.log('11. Click "Exchange authorization code for tokens"\n');
console.log('12. Copy the "id_token" value from the response\n');

console.log('═══════════════════════════════════════════════════════════');
console.log('📋 METHOD 2: Using Direct Google OAuth URL\n');
console.log('─────────────────────────────────────────\n');

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${GOOGLE_CLIENT_ID}&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
  `response_type=code&` +
  `scope=openid%20email%20profile&` +
  `login_hint=vijay.wiz@gmail.com`;

console.log('1. Open this URL in your browser:\n');
console.log(authUrl + '\n');
console.log('2. Sign in with vijay.wiz@gmail.com\n');
console.log('3. You\'ll be redirected to localhost with a code parameter\n');
console.log('4. Copy the code from URL\n');
console.log('5. Use the code to get tokens (requires backend exchange)\n');

console.log('═══════════════════════════════════════════════════════════');
console.log('📝 POSTMAN TEST SETUP\n');
console.log('─────────────────────\n');

console.log('After getting your Google ID token:\n');
console.log('1. Open Postman\n');
console.log('2. Create NEW request\n');
console.log('3. Set method to: POST\n');
console.log('4. Set URL to:\n');
console.log('   https://yovoaiapi.diintech.com/api/auth/google/verify\n');
console.log('5. Go to "Headers" tab and add:');
console.log('   Key: Content-Type');
console.log('   Value: application/json\n');
console.log('6. Go to "Body" tab, select "raw" and "JSON"\n');
console.log('7. Paste this JSON:');
console.log(JSON.stringify({
  googleToken: "PASTE_YOUR_GOOGLE_ID_TOKEN_HERE"
}, null, 2));
console.log('\n8. Replace PASTE_YOUR_GOOGLE_ID_TOKEN_HERE with actual token\n');
console.log('9. Click "Send"\n');

console.log('═══════════════════════════════════════════════════════════');
console.log('✅ EXPECTED SUCCESS RESPONSE\n');
console.log('─────────────────────────────\n');
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

console.log('\n═══════════════════════════════════════════════════════════');
console.log('🎯 QUICK STEPS SUMMARY\n');
console.log('1. Get Google ID token from OAuth Playground');
console.log('2. Open Postman');
console.log('3. POST to: https://yovoaiapi.diintech.com/api/auth/google/verify');
console.log('4. Send JSON: {"googleToken":"YOUR_TOKEN"}');
console.log('5. Get authToken in response');
console.log('6. Use authToken for authenticated requests\n');
console.log('═══════════════════════════════════════════════════════════\n');
