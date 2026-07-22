const axios = require('axios');

async function testProductionAPI() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 TESTING PRODUCTION API');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Test 1: Check if API is running
    console.log('Test 1: Checking API health...\n');
    try {
      const healthResponse = await axios.get('https://yovoaiapi.diintech.com/api/health');
      console.log('✅ API is running');
      console.log('Response:', JSON.stringify(healthResponse.data, null, 2));
    } catch (error) {
      console.log('❌ API health check failed');
      console.log('Error:', error.message);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('Test 2: Checking Google Auth test endpoint...\n');
    try {
      const testResponse = await axios.get('https://yovoaiapi.diintech.com/api/auth/google/test');
      console.log('✅ Google Auth endpoint exists');
      console.log('Response:', JSON.stringify(testResponse.data, null, 2));
    } catch (error) {
      console.log('❌ Google Auth endpoint not found');
      console.log('Status:', error.response?.status);
      console.log('Error:', error.response?.data || error.message);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('Test 3: Testing verify endpoint with invalid token...\n');
    try {
      const verifyResponse = await axios.post(
        'https://yovoaiapi.diintech.com/api/auth/google/verify',
        { googleToken: 'invalid-token' }
      );
      console.log('Response:', JSON.stringify(verifyResponse.data, null, 2));
    } catch (error) {
      console.log('Status:', error.response?.status);
      console.log('Response:', JSON.stringify(error.response?.data, null, 2));
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✅ PRODUCTION API STATUS\n');
    console.log('If you see 401 errors above, the API is working correctly.');
    console.log('The 401 means the token is invalid, which is expected.\n');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testProductionAPI();
