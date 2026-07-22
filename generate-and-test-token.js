const admin = require('firebase-admin');
const axios = require('axios');

const FIREBASE_PROJECT_ID = 'yovoai';
const FIREBASE_API_KEY = 'AIzaSyADiUc4XZo4hz6qnZm4b0YFsQzTFDKEBYQ';

// Initialize Firebase Admin SDK with service account
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: FIREBASE_PROJECT_ID
});

async function generateTokenAndTestAPI() {
  try {
    const email = 'vijay.wiz@gmail.com';
    
    // Step 1: Create or get user
    console.log('🔐 Step 1: Creating/Getting Firebase User...\n');
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
      console.log('✅ User already exists');
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        user = await admin.auth().createUser({
          email: email,
          displayName: 'Vijay Test',
          photoURL: 'https://example.com/photo.jpg'
        });
        console.log('✅ User created');
      } else {
        throw error;
      }
    }

    // Step 2: Generate custom token
    console.log('\n🔐 Step 2: Generating Firebase ID Token...\n');
    const customToken = await admin.auth().createCustomToken(user.uid);
    console.log('✅ Custom Token Generated');

    // Step 3: Exchange custom token for ID token
    console.log('\n🔄 Step 3: Exchanging Custom Token for ID Token...\n');
    const exchangeUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`;
    
    const exchangeResponse = await axios.post(exchangeUrl, {
      token: customToken,
      returnSecureToken: true
    });

    const idToken = exchangeResponse.data.idToken;
    console.log('✅ ID Token Generated:');
    console.log(`Token: ${idToken.substring(0, 50)}...\n`);

    // Step 4: Hit the API route
    console.log('🚀 Step 4: Hitting Google Login API Route...\n');
    const apiUrl = 'http://localhost:5000/api/auth/google/verify';
    
    const apiResponse = await axios.post(apiUrl, {
      googleToken: idToken
    });

    console.log('✅ API Response Successful!\n');
    console.log('Status:', apiResponse.status);
    console.log('Response Data:');
    console.log(JSON.stringify(apiResponse.data, null, 2));

    process.exit(0);

  } catch (error) {
    console.error('❌ Error:');
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

generateTokenAndTestAPI();
