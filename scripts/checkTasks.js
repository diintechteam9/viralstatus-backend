require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const CT = require('../models/CampaignTask');
  const ids = ['6a47ad637a94e5d10a1faf75','6a47ae007a94e5d10a1fb010','6a47ae5d7a94e5d10a1fb031'];
  const tasks = await CT.find({ _id: { $in: ids } }).lean();
  tasks.forEach(t => console.log(String(t._id), t.contentCategory, t.taskType, t.platform));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
