const axios = require('axios');

async function testToken() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 TESTING GOOGLE LOGIN WITH TOKEN');
    console.log('═══════════════════════════════════════════════════════════\n');

    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20veW92b2FpIiwiYXVkIjoieW92b2FpIiwiYXV0aF90aW1lIjoxNzg0NzQ0MzQ3LCJ1c2VyX2lkIjoiVmlqYXlXaXpVc2VyMTIzIiwic3ViIjoiVmlqYXlXaXpVc2VyMTIzIiwiaWF0IjoxNzg0NzQ0MzQ3LCJleHAiOjE3ODQ3NDc5NDcsImVtYWlsIjoidmlqYXkud2l6QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiVmlqYXkgV2l6IiwicGljdHVyZSI6Imh0dHBzOi8vbGgzLmdvb2dsZXVzZXJjb250ZW50LmNvbS9hL2RlZmF1bHQtdXNlcj1zOTYtYyIsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyIxMjM0NTY3ODkwMTIzNDU2Nzg5MDEiXSwiZW1haWwiOlsidmlqYXkud2l6QGdtYWlsLmNvbSJdfSwic2lnbl9pbl9wcm92aWRlciI6Imdvb2dsZS5jb20ifX0.xCUC_eHhiNW0xsNDb6LwlQDM0q4geOQBO3i0L-8gJro';

    console.log('📝 Token:');
    console.log(token.substring(0, 50) + '...\n');

    console.log('🌐 Testing API...\n');

    try {
      const response = await axios.post(
        'https://yovoaiapi.diintech.com/api/auth/google/verify',
        { googleToken: token }
      );

      console.log('✅ SUCCESS!\n');
      console.log('Status:', response.status);
      console.log('Response:');
      console.log(JSON.stringify(response.data, null, 2));

    } catch (error) {
      console.log('Status:', error.response?.status);
      console.log('Response:');
      console.log(JSON.stringify(error.response?.data, null, 2));
    }

    console.log('\n═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

testToken();
