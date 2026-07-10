require('dotenv').config();
const connectDB = require('../config/db');
const UGCPrompter = require('../models/UGCPrompter');
const UGCVideo = require('../models/UGCVideo');
const UGCSubmission = require('../models/UGCSubmission');

async function cleanUGCData() {
  await connectDB();

  const prompters = await UGCPrompter.deleteMany({});
  console.log(`✅ UGCPrompter deleted: ${prompters.deletedCount}`);

  const videos = await UGCVideo.deleteMany({});
  console.log(`✅ UGCVideo deleted: ${videos.deletedCount}`);

  const submissions = await UGCSubmission.deleteMany({});
  console.log(`✅ UGCSubmission deleted: ${submissions.deletedCount}`);

  console.log('🎉 All UGC data cleared.');
  process.exit(0);
}

cleanUGCData().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
