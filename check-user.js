const mongoose = require('mongoose');
const User = require('./models/user');
const Client = require('./models/client');
require('dotenv').config();

async function checkUser() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 CHECKING DATABASE FOR: vijay.wiz@gmail.com');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Connect to MongoDB
    console.log('📝 Connecting to MongoDB...\n');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const email = 'vijay.wiz@gmail.com';

    // Check User collection
    console.log('🔍 Checking User collection...\n');
    const user = await User.findOne({ email: email });
    
    if (user) {
      console.log('✅ USER FOUND IN USER COLLECTION!\n');
      console.log('User Details:');
      console.log(JSON.stringify(user, null, 2));
    } else {
      console.log('❌ User NOT found in User collection\n');
    }

    // Check Client collection
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🔍 Checking Client collection...\n');
    const client = await Client.findOne({ email: email });
    
    if (client) {
      console.log('✅ CLIENT FOUND IN CLIENT COLLECTION!\n');
      console.log('Client Details:');
      console.log(JSON.stringify(client, null, 2));
    } else {
      console.log('❌ Client NOT found in Client collection\n');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 SUMMARY:\n');
    console.log(`User exists: ${user ? '✅ YES' : '❌ NO'}`);
    console.log(`Client exists: ${client ? '✅ YES' : '❌ NO'}`);
    console.log('\n═══════════════════════════════════════════════════════════\n');

    // Close connection
    await mongoose.connection.close();

  } catch (error) {
    console.error('❌ ERROR:\n');
    console.error('Message:', error.message);
  }
}

checkUser();
