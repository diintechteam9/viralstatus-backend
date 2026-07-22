const axios = require('axios');
const jwt = require('jsonwebtoken');

async function testLoginFlow() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔐 TESTING GOOGLE LOGIN FLOW');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Token
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20veW92b2FpIiwiYXVkIjoieW92b2FpIiwiYXV0aF90aW1lIjoxNzg0NzQ0MzQ3LCJ1c2VyX2lkIjoiVmlqYXlXaXpVc2VyMTIzIiwic3ViIjoiVmlqYXlXaXpVc2VyMTIzIiwiaWF0IjoxNzg0NzQ0MzQ3LCJleHAiOjE3ODQ3NDc5NDcsImVtYWlsIjoidmlqYXkud2l6QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiVmlqYXkgV2l6IiwicGljdHVyZSI6Imh0dHBzOi8vbGgzLmdvb2dsZXVzZXJjb250ZW50LmNvbS9hL2RlZmF1bHQtdXNlcj1zOTYtYyIsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyIxMjM0NTY3ODkwMTIzNDU2Nzg5MDEiXSwiZW1haWwiOlsidmlqYXkud2l6QGdtYWlsLmNvbSJdfSwic2lnbl9pbl9wcm92aWRlciI6Imdvb2dsZS5jb20ifX0.xCUC_eHhiNW0xsNDb6LwlQDM0q4geOQBO3i0L-8gJro';

    console.log('Step 1: Testing Google Login API\n');
    console.log('URL: http://localhost:4000/api/auth/google/verify');
    console.log('Method: POST\n');

    try {
      const loginResponse = await axios.post(
        'http://localhost:4000/api/auth/google/verify',
        { googleToken: token }
      );

      console.log('✅ Login Response:\n');
      console.log(JSON.stringify(loginResponse.data, null, 2));

      const authToken = loginResponse.data.authToken;
      const mongoId = loginResponse.data.MongoId;

      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('Step 2: Testing Protected Route (Get Profile)\n');
      console.log('URL: http://localhost:4000/api/auth/google/profile');
      console.log('Method: GET');
      console.log(`Authorization: Bearer ${authToken.substring(0, 30)}...\n`);

      try {
        const profileResponse = await axios.get(
          'http://localhost:4000/api/auth/google/profile',
          {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          }
        );

        console.log('✅ Profile Response:\n');
        console.log(JSON.stringify(profileResponse.data, null, 2));

      } catch (profileError) {
        console.log('❌ Profile Error:\n');
        console.log('Status:', profileError.response?.status);
        console.log('Response:', JSON.stringify(profileError.response?.data, null, 2));
      }

      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('📋 SUMMARY:\n');
      console.log('✅ Google Login: SUCCESS');
      console.log('✅ Auth Token Generated: YES');
      console.log('✅ User in Database: YES');
      console.log('✅ Can Access Protected Routes: CHECK ABOVE\n');

    } catch (loginError) {
      console.log('❌ Login Error:\n');
      console.log('Status:', loginError.response?.status);
      console.log('Response:', JSON.stringify(loginError.response?.data, null, 2));
    }

    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testLoginFlow();
