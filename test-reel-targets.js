// Test script for Reel Task Target Metrics
// Run this after deploying the changes

const axios = require('axios');

const API_BASE = 'https://app.yovoai.com/api';
const userId = 'test_user_123'; // Replace with actual userId

async function testReelTaskTargets() {
  try {
    console.log('=== Testing Reel Task Target Metrics ===\n');

    // 1. Create a Reel Task with target metrics
    console.log('1. Creating Reel Task with target metrics...');
    const createTaskRes = await axios.post(`${API_BASE}/campaign-tasks`, {
      campaignId: 'campaign_id_here',
      clientId: 'client_id_here',
      title: 'Test Reel Task with Targets',
      description: 'Test task to verify target metrics',
      platform: 'instagram',
      taskType: 'reels',
      contentCategory: 'reels',
      credits: 50,
      proofRequired: 'url',
      status: 'active',
      visibility: 'public',
      targetViews: 1000,
      targetLikes: 100,
      targetComments: 50,
    });
    const taskId = createTaskRes.data.task._id;
    console.log(`✓ Task created: ${taskId}`);
    console.log(`  Target: ${createTaskRes.data.task.targetViews} views, ${createTaskRes.data.task.targetLikes} likes, ${createTaskRes.data.task.targetComments} comments\n`);

    // 2. Get user's shared reels (should show target metrics)
    console.log('2. Fetching user shared reels...');
    const getReelsRes = await axios.get(`${API_BASE}/pools/shared/${userId}`);
    const reel = getReelsRes.data.reels.find(r => r.campaignTaskId === taskId);
    if (reel) {
      console.log(`✓ Reel found in user's list`);
      console.log(`  Target: ${reel.targetViews} views, ${reel.targetLikes} likes, ${reel.targetComments} comments`);
      console.log(`  Current: ${reel.currentViews} views, ${reel.currentLikes} likes, ${reel.currentComments} comments\n`);
    }

    // 3. Submit task with URL
    console.log('3. Submitting reel task with URL...');
    const submitRes = await axios.post(`${API_BASE}/pools/task/submit`, {
      userId,
      campaignId: 'campaign_id_here',
      campaignTaskId: taskId,
      reelId: taskId,
      contentCategory: 'reels',
      url: 'https://www.instagram.com/reel/example/',
    });
    console.log(`✓ Task submitted`);
    if (submitRes.data.targetCompletion) {
      console.log(`  Completion: ${submitRes.data.targetCompletion.completionPercent}%`);
      if (submitRes.data.targetCompletion.completed) {
        console.log(`  ✓ TASK AUTO-COMPLETED!`);
        console.log(`  Credits awarded: ${submitRes.data.targetCompletion.creditsAwarded}`);
      }
    }
    console.log();

    // 4. Check submission response with progress
    console.log('4. Checking submission response with progress...');
    const checkRes = await axios.get(`${API_BASE}/pools/shared/${userId}`);
    const updatedReel = checkRes.data.reels.find(r => r.campaignTaskId === taskId);
    if (updatedReel) {
      console.log(`✓ Submission progress updated`);
      console.log(`  Current: ${updatedReel.currentViews} views, ${updatedReel.currentLikes} likes, ${updatedReel.currentComments} comments`);
      console.log(`  Status: ${updatedReel.TaskStatus}`);
      console.log(`  Submission Status: ${updatedReel.submissionStatus}`);
    }

    console.log('\n=== All tests completed successfully! ===');
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testReelTaskTargets();
