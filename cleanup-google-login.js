const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('./models/user');
const Client = require('./models/client');

const cleanupGoogleLoginIssue = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const email = 'vijay.wiz@gmail.com';

    // Delete from User collection
    const userResult = await User.deleteOne({ email });
    console.log(`🗑️  Deleted from User collection: ${userResult.deletedCount} document(s)`);

    // Delete from Client collection
    const clientResult = await Client.deleteOne({ email });
    console.log(`🗑️  Deleted from Client collection: ${clientResult.deletedCount} document(s)`);

    console.log('✅ Cleanup completed successfully!');
    console.log('Now try logging in with vijay.wiz@gmail.com again');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    process.exit(1);
  }
};

cleanupGoogleLoginIssue();
