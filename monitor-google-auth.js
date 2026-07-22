const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('./models/user');
const Client = require('./models/client');

/**
 * Monitor Google authentication issues
 * Run this periodically to detect corrupted entries
 */
const monitorGoogleAuthIssues = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Check for Google users with empty passwords
    const usersWithEmptyPassword = await User.find({
      isGoogleUser: true,
      password: { $in: ['', null] }
    });

    const clientsWithEmptyPassword = await Client.find({
      isGoogleUser: true,
      password: { $in: ['', null] }
    });

    // Check for Google users without googleId
    const usersWithoutGoogleId = await User.find({
      isGoogleUser: true,
      googleId: { $in: ['', null] }
    });

    const clientsWithoutGoogleId = await Client.find({
      isGoogleUser: true,
      googleId: { $in: ['', null] }
    });

    // Check for duplicate emails
    const userEmails = await User.aggregate([
      { $group: { _id: '$email', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]);

    const clientEmails = await Client.aggregate([
      { $group: { _id: '$email', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]);

    console.log('📊 Google Authentication Health Report\n');
    console.log('─'.repeat(50));

    if (usersWithEmptyPassword.length > 0) {
      console.log(`⚠️  Users with empty password: ${usersWithEmptyPassword.length}`);
      usersWithEmptyPassword.forEach(u => console.log(`   - ${u.email}`));
    }

    if (clientsWithEmptyPassword.length > 0) {
      console.log(`⚠️  Clients with empty password: ${clientsWithEmptyPassword.length}`);
      clientsWithEmptyPassword.forEach(c => console.log(`   - ${c.email}`));
    }

    if (usersWithoutGoogleId.length > 0) {
      console.log(`⚠️  Users marked as Google but no googleId: ${usersWithoutGoogleId.length}`);
      usersWithoutGoogleId.forEach(u => console.log(`   - ${u.email}`));
    }

    if (clientsWithoutGoogleId.length > 0) {
      console.log(`⚠️  Clients marked as Google but no googleId: ${clientsWithoutGoogleId.length}`);
      clientsWithoutGoogleId.forEach(c => console.log(`   - ${c.email}`));
    }

    if (userEmails.length > 0) {
      console.log(`⚠️  Duplicate emails in Users: ${userEmails.length}`);
      userEmails.forEach(e => console.log(`   - ${e._id} (${e.count} times)`));
    }

    if (clientEmails.length > 0) {
      console.log(`⚠️  Duplicate emails in Clients: ${clientEmails.length}`);
      clientEmails.forEach(e => console.log(`   - ${e._id} (${e.count} times)`));
    }

    if (
      usersWithEmptyPassword.length === 0 &&
      clientsWithEmptyPassword.length === 0 &&
      usersWithoutGoogleId.length === 0 &&
      clientsWithoutGoogleId.length === 0 &&
      userEmails.length === 0 &&
      clientEmails.length === 0
    ) {
      console.log('✅ All systems healthy! No issues detected.');
    }

    console.log('─'.repeat(50));
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during monitoring:', error.message);
    process.exit(1);
  }
};

monitorGoogleAuthIssues();
