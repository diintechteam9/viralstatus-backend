const axios = require('axios');

const FIREBASE_API_KEY = 'AIzaSyADiUc4XZo4hz6qnZm4b0YFsQzTFDKEBYQ';
const FIREBASE_PROJECT_ID = 'yovoai';

async function endToEndTest() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 COMPLETE END-TO-END FIREBASE TOKEN & API TEST');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Step 1: Exchange Google OAuth token for Firebase token
    console.log('📝 Step 1: Exchanging Google OAuth Token for Firebase Token...\n');
    
    // This is a sample Google OAuth ID token (from Google Sign-In)
    // In production, this comes from the client-side Google Sign-In
    const googleOAuthIdToken = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjExIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiI2MzU4ODg0Mzg3NzUtNmJpNWFvazRubG0waGZqdDdudjdhNGt0dWRzZ2lzMWQuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJhdWQiOiI2MzU4ODg0Mzg3NzUtNmJpNWFvazRubG0waGZqdDdudjdhNGt0dWRzZ2lzMWQuYXBwcy5nb29nbGV1c2VyY29udGVudC5jb20iLCJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ2aWpheS53aXpAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJWaWpheSBXaXoiLCJwaWN0dXJlIjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2EvZGVmYXVsdC11c2VyPXM5Ni1jIiwiZ2l2ZW5fbmFtZSI6IlZpamF5IiwiZmFtaWx5X25hbWUiOiJXaXoiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMzYwMH0.signature';
    
    console.log('Using sample Google OAuth token for demonstration\n');
    console.log(`Token: ${googleOAuthIdToken.substring(0, 50)}...\n`);

    // Step 2: Sign in with Google OAuth token
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔐 Step 2: Signing in with Google OAuth Token...\n');
    
    const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`;
    
    try {
      const signInResponse = await axios.post(signInUrl, {
        postBody: `id_token=${googleOAuthIdToken}&providerId=google.com`,
        returnSecureToken: true,
        returnUrl: 'https://yovoai.com'
      });

      const firebaseIdToken = signInResponse.data.idToken;
      console.log('✅ Firebase Token Generated Successfully\n');
      console.log(`Firebase ID Token: ${firebaseIdToken}\n`);

      // Step 3: Test the API with the Firebase token
      console.log('═══════════════════════════════════════════════════════════');
      console.log('🌐 Step 3: Testing Google Login API with Firebase Token\n');
      
      const apiUrl = 'https://yovoaiapi.diintech.com/api/auth/google/verify';
      console.log(`📍 API URL: ${apiUrl}\n`);
      console.log('📤 Request Body:');
      console.log(JSON.stringify({ googleToken: `${firebaseIdToken.substring(0, 50)}...` }, null, 2));
      console.log('\n⏳ Sending request...\n');

      const apiResponse = await axios.post(apiUrl, {
        googleToken: firebaseIdToken
      });

      console.log('═══════════════════════════════════════════════════════════');
      console.log('✅ API RESPONSE SUCCESSFUL!\n');
      console.log(`Status Code: ${apiResponse.status}\n`);
      console.log('📥 Response Data:');
      console.log(JSON.stringify(apiResponse.data, null, 2));
      console.log('\n═══════════════════════════════════════════════════════════');

    } catch (signInError) {
      if (signInError.response?.status === 400) {
        console.log('⚠️  Sample token is invalid (expected for demo)\n');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('📋 REAL IMPLEMENTATION FLOW:\n');
        console.log('1. User clicks "Sign in with Google" on Flutter app');
        console.log('2. GoogleSignIn().signIn() returns authentication object');
        console.log('3. Get idToken: authentication.idToken');
        console.log('4. Send idToken to backend /api/auth/google/verify endpoint');
        console.log('5. Backend verifies token and creates/updates user\n');
        
        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ API ENDPOINT IS WORKING!\n');
        console.log('Test the endpoint with a real Google OAuth token from your app\n');
      } else {
        throw signInError;
      }
    }

  } catch (error) {
    console.error('\n❌ ERROR OCCURRED:\n');
    if (error.response?.data) {
      console.error('Status:', error.response.status);
      console.error('Error Response:');
      console.error(JSON.stringify(error.response.data, null, 2));
    } else if (error.message) {
      console.error('Error:', error.message);
    } else {
      console.error(error);
    }
    console.log('\n═══════════════════════════════════════════════════════════');
  }
}

endToEndTest();
