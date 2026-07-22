const axios = require('axios');

const FIREBASE_API_KEY = 'AIzaSyADiUc4XZo4hz6qnZm4b0YFsQzTFDKEBYQ';

async function testVijayGoogleLogin() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 GOOGLE LOGIN TEST FOR vijay.wiz@gmail.com');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📋 TESTING APPROACH:\n');
    console.log('Since we need a REAL Google OAuth token, here are the options:\n');

    console.log('OPTION 1: Using Flutter App (RECOMMENDED)');
    console.log('─────────────────────────────────────────');
    console.log('1. Run Flutter app on device/emulator');
    console.log('2. Click "Sign in with Google"');
    console.log('3. Select vijay.wiz@gmail.com');
    console.log('4. App automatically sends token to backend');
    console.log('5. Check backend logs for response\n');

    console.log('OPTION 2: Using Google OAuth 2.0 Playground');
    console.log('──────────────────────────────────────────');
    console.log('1. Go to: https://developers.google.com/oauthplayground');
    console.log('2. Select "Google OAuth 2.0 API v2"');
    console.log('3. Click "Authorize APIs"');
    console.log('4. Sign in with vijay.wiz@gmail.com');
    console.log('5. Get the access token');
    console.log('6. Use it to test the API\n');

    console.log('OPTION 3: Using curl with Google OAuth Token');
    console.log('────────────────────────────────────────────');
    console.log('curl -X POST https://yovoaiapi.diintech.com/api/auth/google/verify \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"googleToken":"YOUR_GOOGLE_OAUTH_TOKEN"}\'\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🌐 TESTING API ENDPOINTS\n');

    // Test 1: Check if API is running
    console.log('Test 1: Checking API Status');
    console.log('──────────────────────────');
    const testUrl = 'https://yovoaiapi.diintech.com/api/auth/google/test';
    const testResponse = await axios.get(testUrl);
    console.log(`✅ Status: ${testResponse.status}`);
    console.log(`✅ Message: ${testResponse.data.message}\n`);

    // Test 2: Show what happens when we send invalid token
    console.log('Test 2: Testing with Invalid Token');
    console.log('──────────────────────────────────');
    try {
      const invalidResponse = await axios.post(
        'https://yovoaiapi.diintech.com/api/auth/google/verify',
        { googleToken: 'invalid-token-123' }
      );
    } catch (error) {
      console.log(`✅ Status: ${error.response.status}`);
      console.log(`✅ Error: ${error.response.data.message}\n`);
    }

    // Test 3: Show expected response structure
    console.log('Test 3: Expected Success Response');
    console.log('────────────────────────────────');
    console.log('When you send a valid Google token, you\'ll get:\n');
    console.log(JSON.stringify({
      success: true,
      message: "Verified successfully",
      authToken: "jwt_token_here",
      MongoId: "user_id_in_database",
      isClient: false,
      email: "vijay.wiz@gmail.com",
      name: "Vijay Wiz",
      emailVerified: true,
      isProfileCompleted: false,
      googleId: "google_user_id"
    }, null, 2));

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📝 NEXT STEPS:\n');
    console.log('1. Get a real Google OAuth token using one of the options above');
    console.log('2. Send it to: POST /api/auth/google/verify');
    console.log('3. Backend will create/update user in database');
    console.log('4. You\'ll receive JWT token for authenticated requests\n');

    console.log('═══════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testVijayGoogleLogin();
