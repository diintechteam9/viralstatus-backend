require('dotenv').config();
const mongoose = require('mongoose');

const email = 'anilkumarsingh43425@gmail.com';

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const result = await mongoose.connection.db.collection('mobileusers').deleteOne({ email });
  console.log(result.deletedCount ? `✅ Deleted: ${email}` : `❌ Not found: ${email}`);
  process.exit(0);
}).catch(err => { console.error('DB Error:', err.message); process.exit(1); });
