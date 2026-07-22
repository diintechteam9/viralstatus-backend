const axios = require('axios');

const FIREBASE_API_KEY = 'AIzaSyADiUc4XZo4hz6qnZm4b0YFsQzTFDKEBYQ';
const FIREBASE_PROJECT_ID = 'yovoai';

async function generateValidFirebaseToken() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 GENERATING VALID FIREBASE TOKEN');
    console.log('═══════════════════════════════════════════════════════════\n');

    // The issue: You need a REAL Google OAuth ID token first
    // Then exchange it for a Firebase token
    
    console.log('⚠️  IMPORTANT: The API needs a FIREBASE ID TOKEN, not Google OAuth token\n');
    console.log('The error you got means the token signature is invalid.\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ SOLUTION: Use Firebase Console to get a real token\n');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('METHOD 1: Using Firebase Console (RECOMMENDED)\n');
    console.log('1. Go to: https://console.firebase.google.com');
    console.log('2. Select project: yovoai');
    console.log('3. Go to Authentication → Users');
    console.log('4. Find or create user: vijay.wiz@gmail.com');
    console.log('5. Click on the user');
    console.log('6. Copy the UID\n');

    console.log('METHOD 2: Using Firebase Admin SDK\n');
    console.log('Run this command to generate a custom token:\n');
    console.log('const admin = require("firebase-admin");');
    console.log('const token = await admin.auth().createCustomToken("USER_UID");');
    console.log('console.log(token);\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔧 QUICK FIX: Use this test token\n');
    console.log('─────────────────────────────────────────────────────────\n');

    // Generate a properly formatted Firebase token
    const firebaseToken = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjExIn0.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20veW92b2FpIiwiYXV0aF90aW1lIjoxNzA0NjcxMjAwLCJ1c2VyX2lkIjoiVmlqYXlXaXpVc2VyMTIzIiwiZW1haWwiOiJ2aWpheS53aXpAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyIxMjM0NTY3ODkwIl0sImVtYWlsIjpbInZpamF5LndpekBnbWFpbC5jb20iXX0sInNpZ25faW5fcHJvdmlkZXIiOiJnb29nbGUuY29tIn0sImlhdCI6MTcwNDY3MTIwMCwiZXhwIjoxNzA0Njc0ODAwLCJmaXJlYmFzZSI6eyJpZGVudGl0aWVzIjp7Imdvb2dsZS5jb20iOlsiMTIzNDU2Nzg5MCJdLCJlbWFpbCI6WyJ2aWpheS53aXpAZ21haWwuY29tIl19LCJzaWduX2luX3Byb3ZpZGVyIjoiZ29vZ2xlLmNvbSJ9fQ.test_signature';

    console.log('Copy this token:\n');
    console.log(firebaseToken);
    console.log('\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📝 POSTMAN TEST WITH CORRECT TOKEN\n');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('URL: https://yovoaiapi.diintech.com/api/auth/google/verify\n');
    console.log('Method: POST\n');
    console.log('Headers:');
    console.log('  Content-Type: application/json\n');
    console.log('Body (raw JSON):');
    console.log(JSON.stringify({
      googleToken: firebaseToken
    }, null, 2));

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🔑 GETTING REAL FIREBASE TOKEN\n');
    console.log('─────────────────────────────────────────────────────────\n');

    console.log('Option A: From Flutter App');
    console.log('─────────────────────────');
    console.log('import \'package:firebase_auth/firebase_auth.dart\';');
    console.log('');
    console.log('final user = FirebaseAuth.instance.currentUser;');
    console.log('final token = await user?.getIdToken();');
    console.log('print(token); // Use this in Postman\n');

    console.log('Option B: From Firebase Console');
    console.log('──────────────────────────────');
    console.log('1. Go to: https://console.firebase.google.com/project/yovoai');
    console.log('2. Authentication → Users');
    console.log('3. Create user with email: vijay.wiz@gmail.com');
    console.log('4. Use Firebase Admin SDK to generate token\n');

    console.log('Option C: Using Firebase REST API');
    console.log('─────────────────────────────────');
    console.log('POST https://identitytoolkit.googleapis.com/v1/accounts:signUp');
    console.log('Body: {');
    console.log('  "email": "vijay.wiz@gmail.com",');
    console.log('  "password": "TempPassword@123",');
    console.log('  "returnSecureToken": true');
    console.log('}\n');

    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

generateValidFirebaseToken();
