const jwt = require('jsonwebtoken');
const axios = require('axios');

async function generateAndTestToken() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 GENERATING TEST TOKEN FOR vijay.wiz@gmail.com');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Create a test token with email claim
    const testToken = jwt.sign(
      {
        iss: 'https://securetoken.google.com/yovoai',
        aud: 'yovoai',
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
      },
      'test-secret-key',
      { algorithm: 'HS256' }
    );

    console.log('✅ TEST TOKEN GENERATED\n');
    console.log('Token:');
    console.log(testToken);
    console.log('\n═══════════════════════════════════════════════════════════');

    // Show Postman request
    console.log('\n📝 POSTMAN REQUEST\n');
    console.log('Method: POST\n');
    console.log('URL:');
    console.log('https://yovoaiapi.diintech.com/api/auth/google/verify\n');
    console.log('Headers:');
    console.log('Content-Type: application/json\n');
    console.log('Body (raw JSON):');
    console.log(JSON.stringify({
      googleToken: testToken
    }, null, 2));

    // Test with localhost
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🌐 TESTING WITH LOCALHOST (if backend is running)\n');

    try {
      const localResponse = await axios.post(
        'http://localhost:4000/api/auth/google/verify',
        { googleToken: testToken },
        { timeout: 5000 }
      );

      console.log('✅ LOCALHOST TEST SUCCESSFUL!\n');
      console.log('Status:', localResponse.status);
      console.log('Response:');
      console.log(JSON.stringify(localResponse.data, null, 2));

    } catch (localError) {
      if (localError.code === 'ECONNREFUSED') {
        console.log('⚠️  Backend not running on localhost:4000\n');
        console.log('To test locally, run:');
        console.log('node index.js\n');
      } else {
        console.log('Response Status:', localError.response?.status);
        console.log('Response:');
        console.log(JSON.stringify(localError.response?.data, null, 2));
      }
    }

    // Test with production
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🌐 TESTING WITH PRODUCTION API\n');

    try {
      const prodResponse = await axios.post(
        'https://yovoaiapi.diintech.com/api/auth/google/verify',
        { googleToken: testToken }
      );

      console.log('✅ PRODUCTION TEST SUCCESSFUL!\n');
      console.log('Status:', prodResponse.status);
      console.log('Response:');
      console.log(JSON.stringify(prodResponse.data, null, 2));

    } catch (prodError) {
      console.log('Response Status:', prodError.response?.status);
      console.log('Response:');
      console.log(JSON.stringify(prodError.response?.data, null, 2));
    }

    console.log('\n═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

generateAndTestToken();
