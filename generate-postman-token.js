const jwt = require('jsonwebtoken');
const axios = require('axios');

const FIREBASE_PROJECT_ID = 'yovoai';

async function generateTestToken() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 GENERATING TEST TOKEN FOR POSTMAN');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Create a token that looks like a Firebase token
    const payload = {
      iss: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      aud: FIREBASE_PROJECT_ID,
      auth_time: Math.floor(Date.now() / 1000),
      user_id: 'VijayWizUser123',
      sub: 'VijayWizUser123',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: 'vijay.wiz@gmail.com',
      email_verified: true,
      name: 'Vijay Wiz',
      picture: 'https://lh3.googleusercontent.com/a/default-user=s96-c',
      firebase: {
        identities: {
          'google.com': ['123456789012345678901'],
          email: ['vijay.wiz@gmail.com']
        },
        sign_in_provider: 'google.com'
      }
    };

    // Sign with a test key (this won't verify with real Firebase keys, but shows structure)
    const testToken = jwt.sign(payload, 'test-secret-key', { 
      algorithm: 'HS256',
      header: { kid: 'test-key-id' }
    });

    console.log('✅ TEST TOKEN GENERATED\n');
    console.log('Token:');
    console.log(testToken);
    console.log('\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📝 POSTMAN REQUEST\n');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('Method: POST\n');
    console.log('URL:');
    console.log('https://yovoaiapi.diintech.com/api/auth/google/verify\n');
    console.log('Headers:');
    console.log('Content-Type: application/json\n');
    console.log('Body (raw JSON):');
    console.log(JSON.stringify({
      googleToken: testToken
    }, null, 2));

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🔑 REAL TOKEN FROM FLUTTER APP\n');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('To get a REAL token from your Flutter app:\n');
    console.log('import \'package:firebase_auth/firebase_auth.dart\';');
    console.log('import \'package:google_sign_in/google_sign_in.dart\';\n');
    console.log('// Sign in with Google');
    console.log('final GoogleSignInAccount? googleUser = await GoogleSignIn().signIn();');
    console.log('final GoogleSignInAuthentication? googleAuth = await googleUser?.authentication;');
    console.log('final String? idToken = googleAuth?.idToken;\n');
    console.log('// Or get Firebase token');
    console.log('final User? user = FirebaseAuth.instance.currentUser;');
    console.log('final String? firebaseToken = await user?.getIdToken();\n');
    console.log('// Use idToken or firebaseToken in Postman\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ TESTING API\n');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('Testing with generated token...\n');

    try {
      const response = await axios.post(
        'https://yovoaiapi.diintech.com/api/auth/google/verify',
        { googleToken: testToken }
      );

      console.log('✅ SUCCESS!\n');
      console.log('Response:');
      console.log(JSON.stringify(response.data, null, 2));

    } catch (error) {
      console.log('Response Status:', error.response?.status);
      console.log('Response:');
      console.log(JSON.stringify(error.response?.data, null, 2));
      console.log('\n⚠️  This is expected - test token signature is not valid');
      console.log('Use a REAL token from Flutter app or Firebase Console\n');
    }

    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

generateTestToken();
