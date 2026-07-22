const mongoose = require('mongoose');
const User = require('./models/user');
const Client = require('./models/client');
require('dotenv').config();

async function deleteUser() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🗑️  DELETING USER: vijay.wiz@gmail.com');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Connect to MongoDB
    console.log('📝 Connecting to MongoDB...\n');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const email = 'vijay.wiz@gmail.com';

    // Delete from User collection
    console.log('🗑️  Deleting from User collection...\n');
    const userResult = await User.deleteOne({ email: email });
    console.log(`✅ Deleted ${userResult.deletedCount} user(s) from User collection\n`);

    // Delete from Client collection
    console.log('🗑️  Deleting from Client collection...\n');
    const clientResult = await Client.deleteOne({ email: email });
    console.log(`✅ Deleted ${clientResult.deletedCount} client(s) from Client collection\n`);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ USER DELETED SUCCESSFULLY!\n');
    console.log('Summary:');
    console.log(`  - Users deleted: ${userResult.deletedCount}`);
    console.log(`  - Clients deleted: ${clientResult.deletedCount}`);
    console.log(`  - Email: ${email}\n`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // Close connection
    await mongoose.connection.close();
    console.log('✅ Database connection closed\n');

  } catch (error) {
    console.error('❌ ERROR:\n');
    console.error('Message:', error.message);
    console.error('\nDetails:', error);
  }
}

deleteUser();
