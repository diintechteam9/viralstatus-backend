/**
 * Migration: Fix UGCSubmission indexes
 * Drops old unique index { campaignId, userId } and creates correct { campaignTaskId, userId }
 * Run: node scripts/fixUgcSubmissionIndex.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  console.log('\n🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected\n');

  const col = mongoose.connection.collection('ugcsubmissions');

  // List current indexes
  const indexes = await col.indexes();
  console.log('📋 Current indexes:');
  indexes.forEach(idx => console.log('  ', JSON.stringify(idx.key), idx.unique ? '(unique)' : ''));
  console.log('');

  // Drop old unique index if it exists
  const oldIndex = indexes.find(idx =>
    idx.key.campaignId === 1 && idx.key.userId === 1 && idx.unique
  );

  if (oldIndex) {
    console.log('🗑️  Dropping old unique index: campaignId_1_userId_1 ...');
    await col.dropIndex('campaignId_1_userId_1');
    console.log('✅ Old index dropped\n');
  } else {
    console.log('ℹ️  Old unique index not found, skipping drop\n');
  }

  // Remove old documents that have null campaignTaskId (pre-migration data)
  const nullResult = await col.deleteMany({ campaignTaskId: { $in: [null, '', undefined] } });
  if (nullResult.deletedCount > 0) {
    console.log(`🗑️  Removed ${nullResult.deletedCount} old submission(s) with null campaignTaskId\n`);
  }

  // Create new unique index { campaignTaskId, userId }
  const newUniqueExists = indexes.find(idx =>
    idx.key.campaignTaskId === 1 && idx.key.userId === 1 && idx.unique
  );
  if (!newUniqueExists) {
    console.log('🔧 Creating new unique index: { campaignTaskId, userId } ...');
    await col.createIndex({ campaignTaskId: 1, userId: 1 }, { unique: true });
    console.log('✅ New unique index created\n');
  } else {
    console.log('ℹ️  New unique index already exists\n');
  }

  // Create non-unique index { campaignId, userId } for lookups
  const lookupExists = indexes.find(idx =>
    idx.key.campaignId === 1 && idx.key.userId === 1 && !idx.unique
  );
  if (!lookupExists) {
    console.log('🔧 Creating lookup index: { campaignId, userId } (non-unique) ...');
    await col.createIndex({ campaignId: 1, userId: 1 });
    console.log('✅ Lookup index created\n');
  } else {
    console.log('ℹ️  Lookup index already exists\n');
  }

  // Final state
  const finalIndexes = await col.indexes();
  console.log('📋 Final indexes:');
  finalIndexes.forEach(idx => console.log('  ', JSON.stringify(idx.key), idx.unique ? '(unique)' : ''));

  console.log('\n🎉 Migration complete!\n');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
