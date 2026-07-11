require('dotenv').config();
const axios = require('axios');

const BASE_URL = 'http://localhost:4000';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhMzM4YjE0YzA4ZGJhZWNmMTAzMjM5ZCIsImVtYWlsIjoiYW5pbGt1bWFyc2luZ2g0MzQyNUBnbWFpbC5jb20iLCJjbGllbnRJZCI6IkNMSS0wMkNSOVciLCJjbGllbnRPYmplY3RJZCI6IjZhMGMxNzJiODliZmRjYTljYWI1MDZmYiIsInJvbGUiOiJtb2JpbGV1c2VyIiwiaWF0IjoxNzgzNDA3NTQxLCJleHAiOjE3ODQwMTIzNDF9.60dE8JDb-v1L8_q8PkvKX_JdzX8gcOra-8MPXrbmTdo';

const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json'
};

async function testAllAPIs() {
  try {
    console.log('🔍 Testing All Three UGC APIs...\n');
    console.log('='.repeat(80));

    // API 1: GET /api/ugc-prompter
    console.log('\n📋 API 1: GET /api/ugc-prompter');
    console.log('-'.repeat(80));
    const promptsRes = await axios.get(`${BASE_URL}/api/ugc-prompter`, { headers });
    const prompts = promptsRes.data.prompts || [];
    console.log(`✅ Response received. Total prompts: ${prompts.length}`);
    
    if (prompts.length > 0) {
      const firstPrompt = prompts[0];
      console.log('\n📊 First Prompt Structure:');
      console.log(`  - id: ${firstPrompt.id}`);
      console.log(`  - _id: ${firstPrompt._id}`);
      console.log(`  - title: ${firstPrompt.title}`);
      console.log(`  - status: ${firstPrompt.status}`);
      console.log(`  - Fields: ${Object.keys(firstPrompt).join(', ')}`);
      
      const promptId = firstPrompt.id || firstPrompt._id;

      // API 2: GET /api/ugc-prompter/public/:promptId
      console.log('\n' + '='.repeat(80));
      console.log(`\n📋 API 2: GET /api/ugc-prompter/public/${promptId}`);
      console.log('-'.repeat(80));
      const publicPromptRes = await axios.get(`${BASE_URL}/api/ugc-prompter/public/${promptId}`, { headers });
      const publicPrompt = publicPromptRes.data.prompt;
      const publicVideos = publicPromptRes.data.videos || [];
      
      console.log(`✅ Response received. Total videos: ${publicVideos.length}`);
      console.log('\n📊 Prompt Structure:');
      console.log(`  - _id: ${publicPrompt._id}`);
      console.log(`  - id: ${publicPrompt.id}`);
      console.log(`  - title: ${publicPrompt.title}`);
      console.log(`  - status: ${publicPrompt.status}`);
      console.log(`  - Fields: ${Object.keys(publicPrompt).join(', ')}`);
      
      if (publicVideos.length > 0) {
        const firstVideo = publicVideos[0];
        console.log('\n📊 First Video Structure (from public API):');
        console.log(`  - id: ${firstVideo.id}`);
        console.log(`  - _id: ${firstVideo._id}`);
        console.log(`  - userId: ${firstVideo.userId}`);
        console.log(`  - status: ${firstVideo.status}`);
        console.log(`  - processingStatus: ${firstVideo.processingStatus}`);
        console.log(`  - videoUrl: ${firstVideo.videoUrl ? '✓' : '✗'}`);
        console.log(`  - processedVideoUrl: ${firstVideo.processedVideoUrl ? '✓' : '✗'}`);
        console.log(`  - viralVideoUrl: ${firstVideo.viralVideoUrl ? '✓' : '✗'}`);
        console.log(`  - Fields: ${Object.keys(firstVideo).join(', ')}`);
      }

      // API 3: GET /api/ugc-video
      console.log('\n' + '='.repeat(80));
      console.log('\n📋 API 3: GET /api/ugc-video');
      console.log('-'.repeat(80));
      const videosRes = await axios.get(`${BASE_URL}/api/ugc-video`, { headers });
      const videos = videosRes.data.videos || [];
      console.log(`✅ Response received. Total videos: ${videos.length}`);
      
      if (videos.length > 0) {
        const firstVideoFromList = videos[0];
        console.log('\n📊 First Video Structure (from video API):');
        console.log(`  - id: ${firstVideoFromList.id}`);
        console.log(`  - _id: ${firstVideoFromList._id}`);
        console.log(`  - promptId: ${firstVideoFromList.promptId}`);
        console.log(`  - userId: ${firstVideoFromList.userId}`);
        console.log(`  - status: ${firstVideoFromList.status}`);
        console.log(`  - processingStatus: ${firstVideoFromList.processingStatus}`);
        console.log(`  - videoUrl: ${firstVideoFromList.videoUrl ? '✓' : '✗'}`);
        console.log(`  - processedVideoUrl: ${firstVideoFromList.processedVideoUrl ? '✓' : '✗'}`);
        console.log(`  - viralVideoUrl: ${firstVideoFromList.viralVideoUrl ? '✓' : '✗'}`);
        console.log(`  - Fields: ${Object.keys(firstVideoFromList).join(', ')}`);

        // COMPARISON
        console.log('\n' + '='.repeat(80));
        console.log('\n🔍 COMPARISON ANALYSIS:');
        console.log('-'.repeat(80));
        
        console.log('\n✅ API 1 (/api/ugc-prompter):');
        console.log(`   - Has "id" field: ${firstPrompt.id ? '✓' : '✗'}`);
        console.log(`   - Has "_id" field: ${firstPrompt._id ? '✓' : '✗'}`);
        
        console.log('\n✅ API 2 (/api/ugc-prompter/public/:promptId):');
        console.log(`   - Prompt has "id" field: ${publicPrompt.id ? '✓' : '✗'}`);
        console.log(`   - Prompt has "_id" field: ${publicPrompt._id ? '✓' : '✗'}`);
        if (publicVideos.length > 0) {
          console.log(`   - Video has "id" field: ${publicVideos[0].id ? '✓' : '✗'}`);
          console.log(`   - Video has "_id" field: ${publicVideos[0]._id ? '✓' : '✗'}`);
        }
        
        console.log('\n✅ API 3 (/api/ugc-video):');
        console.log(`   - Video has "id" field: ${firstVideoFromList.id ? '✓' : '✗'}`);
        console.log(`   - Video has "_id" field: ${firstVideoFromList._id ? '✓' : '✗'}`);
        console.log(`   - Video has "promptId" field: ${firstVideoFromList.promptId ? '✓' : '✗'}`);

        // CONSISTENCY CHECK
        console.log('\n' + '='.repeat(80));
        console.log('\n📌 CONSISTENCY CHECK:');
        console.log('-'.repeat(80));
        
        const hasConsistentIdNaming = 
          (firstPrompt.id || firstPrompt._id) &&
          (publicPrompt.id || publicPrompt._id) &&
          (firstVideoFromList.id || firstVideoFromList._id);
        
        if (hasConsistentIdNaming) {
          console.log('✅ All APIs have ID fields');
        } else {
          console.log('❌ Some APIs missing ID fields');
        }

        const videoHasAllUrls = 
          firstVideoFromList.videoUrl &&
          firstVideoFromList.processedVideoUrl &&
          firstVideoFromList.viralVideoUrl;
        
        if (videoHasAllUrls) {
          console.log('✅ Video API returns all video URLs');
        } else {
          console.log('❌ Video API missing some URLs');
        }

        console.log('\n' + '='.repeat(80));
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testAllAPIs();
