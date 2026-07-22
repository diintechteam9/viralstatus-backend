const axios = require('axios');

const FIREBASE_API_KEY = 'AIzaSyADiUc4XZo4hz6qnZm4b0YFsQzTFDKEBYQ';
const FIREBASE_PROJECT_ID = 'yovoai';
const email = 'vijay.wiz@gmail.com';
const password = 'TestPassword123!';

async function generateTokenAndTestAPI() {
  try {
    // Step 1: Sign in to get ID token
    console.log('🔐 Step 1: Generating Firebase ID Token...\n');
    const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
    
    const signInResponse = await axios.post(signInUrl, {
      email: email,
      password: password,
      returnSecureToken: true
    });

    const idToken = signInResponse.data.idToken;
    console.log('✅ Firebase ID Token Generated:');
    console.log(`Token: ${idToken}\n`);

    // Step 2: Hit the API route with the token
    console.log('🚀 Step 2: Hitting Google Login API Route...\n');
    const apiUrl = 'http://localhost:5000/api/auth/google/verify';
    
    const apiResponse = await axios.post(apiUrl, {
      googleToken: idToken
    });

    console.log('✅ API Response Successful!\n');
    console.log('Status:', apiResponse.status);
    console.log('Response Data:');
    console.log(JSON.stringify(apiResponse.data, null, 2));

  } catch (error) {
    console.error('❌ Error:');
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

generateTokenAndTestAPI();
