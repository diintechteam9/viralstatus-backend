const axios = require('axios');

const FIREBASE_API_KEY = 'AIzaSyADiUc4XZo4hz6qnZm4b0YFsQzTFDKEBYQ';

async function generateFirebaseToken() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 GENERATING FIREBASE TOKEN FOR vijay.wiz@gmail.com');
    console.log('═══════════════════════════════════════════════════════════\n');

    const email = 'vijay.wiz@gmail.com';
    const password = 'VijayTest@12345';

    console.log('📝 Step 1: Creating user...\n');

    const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`;

    let idToken;

    try {
      const signUpResponse = await axios.post(signUpUrl, {
        email: email,
        password: password,
        returnSecureToken: true
      });

      idToken = signUpResponse.data.idToken;
      console.log('✅ New user created successfully\n');

    } catch (signUpError) {
      if (signUpError.response?.data?.error?.message === 'EMAIL_EXISTS') {
        console.log('✅ User already exists, signing in...\n');

        const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;

        const signInResponse = await axios.post(signInUrl, {
          email: email,
          password: password,
          returnSecureToken: true
        });

        idToken = signInResponse.data.idToken;
        console.log('✅ User signed in successfully\n');

      } else {
        throw signUpError;
      }
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ FIREBASE ID TOKEN GENERATED\n');
    console.log('Token:');
    console.log(idToken);
    console.log('\n═══════════════════════════════════════════════════════════');

    // Show Postman request
    console.log('\n📝 POSTMAN REQUEST\n');
    console.log('─────────────────────────────────────────────────────────\n');
    console.log('Method: POST\n');
    console.log('URL:');
    console.log('https://yovoaiapi.diintech.com/api/auth/google/verify\n');
    console.log('Headers:');
    console.log('Content-Type: application/json\n');
    console.log('Body (raw JSON):');
    console.log(JSON.stringify({
      googleToken: idToken
    }, null, 2));

    // Test the API
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🌐 Step 2: Testing API with token...\n');

    try {
      const apiResponse = await axios.post(
        'https://yovoaiapi.diintech.com/api/auth/google/verify',
        { googleToken: idToken }
      );

      console.log('✅ API RESPONSE SUCCESSFUL!\n');
      console.log('Status:', apiResponse.status);
      console.log('Response:');
      console.log(JSON.stringify(apiResponse.data, null, 2));

    } catch (apiError) {
      console.log('API Response:\n');
      console.log('Status:', apiError.response?.status);
      console.log('Response:');
      console.log(JSON.stringify(apiError.response?.data, null, 2));
    }

    console.log('\n═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ ERROR:\n');
    console.error('Message:', error.message);
    
    if (error.response?.data?.error) {
      console.error('Firebase Error:', error.response.data.error.message);
      console.error('\nPossible causes:');
      console.error('1. Password login is still DISABLED in Firebase');
      console.error('2. Email/Password provider not enabled');
      console.error('\nSolution:');
      console.error('Go to: https://console.firebase.google.com/project/yovoai/authentication/providers');
      console.error('Enable "Email/Password" provider');
    }
  }
}

generateFirebaseToken();
