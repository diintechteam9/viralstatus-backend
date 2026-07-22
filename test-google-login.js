const axios = require('axios');

const FIREBASE_API_KEY = 'AIzaSyADiUc4XZo4hz6qnZm4b0YFsQzTFDKEBYQ';
const email = 'vijay.wiz@gmail.com';
const password = 'TestPassword123!';

async function testGoogleLogin() {
  try {
    console.log('Step 1: Signing in Firebase user...');
    const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
    
    const signInResponse = await axios.post(signInUrl, {
      email: email,
      password: password,
      returnSecureToken: true
    });

    const idToken = signInResponse.data.idToken;
    console.log('✓ Firebase user signed in');
    console.log(`  ID Token: ${idToken.substring(0, 50)}...\n`);

    console.log('Step 2: Testing Google Login API...');
    const loginUrl = 'http://localhost:5000/api/auth/google/verify';
    
    const loginResponse = await axios.post(loginUrl, {
      googleToken: idToken
    });

    console.log('✓ Google Login API successful');
    console.log(`  Status: ${loginResponse.status}`);
    console.log(`  Response:`, JSON.stringify(loginResponse.data, null, 2));

  } catch (error) {
    console.error('✗ Error:', error.response?.data || error.message);
  }
}

testGoogleLogin();
