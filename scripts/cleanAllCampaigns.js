/**
 * Migration: Delete ALL Campaign + Task data
 * Run: node scripts/cleanAllCampaigns.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  console.log('\n🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected\n');

  const Campaign          = require('../models/campaign');
  const RegisteredCampaign = require('../models/RegisteredCampaign');
  const SharedReels       = require('../models/SharedReels');
  const UserResponse      = require('../models/userResponse');
  const CampaignTask      = require('../models/CampaignTask');

  const [c1, c2, c3, c4, c5] = await Promise.all([
    Campaign.countDocuments(),
    RegisteredCampaign.countDocuments(),
    SharedReels.countDocuments(),
    UserResponse.countDocuments(),
    CampaignTask.countDocuments(),
  ]);

  console.log('📊 Current counts:');
  console.log(`   Campaigns           : ${c1}`);
  console.log(`   RegisteredCampaigns : ${c2}`);
  console.log(`   SharedReels         : ${c3}`);
  console.log(`   UserResponses       : ${c4}`);
  console.log(`   CampaignTasks       : ${c5}`);
  console.log('');

  const [r1, r2, r3, r4, r5] = await Promise.all([
    Campaign.deleteMany({}),
    RegisteredCampaign.deleteMany({}),
    SharedReels.deleteMany({}),
    UserResponse.deleteMany({}),
    CampaignTask.deleteMany({}),
  ]);

  console.log('✅ Campaigns deleted           :', r1.deletedCount);
  console.log('✅ RegisteredCampaigns deleted :', r2.deletedCount);
  console.log('✅ SharedReels deleted         :', r3.deletedCount);
  console.log('✅ UserResponses deleted       :', r4.deletedCount);
  console.log('✅ CampaignTasks deleted       :', r5.deletedCount);
  console.log('\n🎉 All campaign & task data cleaned!\n');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
