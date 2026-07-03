require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const CT = require('../models/CampaignTask');

  const r1 = await CT.updateOne({ _id: '6a47ad637a94e5d10a1faf75' }, { $set: { taskType: 'upload_reel', platform: 'both', proofRequired: 'url' } });
  const r2 = await CT.updateOne({ _id: '6a47ae007a94e5d10a1fb010' }, { $set: { taskType: 'comment', platform: 'both' } });
  const r3 = await CT.updateOne({ _id: '6a47ae5d7a94e5d10a1fb031' }, { $set: { taskType: 'comment', platform: 'both' } });

  console.log('ugc fix:', r1.modifiedCount);
  console.log('app_review fix:', r2.modifiedCount);
  console.log('gmb_review fix:', r3.modifiedCount);
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
