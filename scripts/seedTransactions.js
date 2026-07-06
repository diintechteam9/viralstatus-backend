// ─── Seed Script: Transaction History ────────────────────────────────────────
// Usage: node scripts/seedTransactions.js <userId>
// Example: node scripts/seedTransactions.js user123

require('dotenv').config();
const mongoose = require('mongoose');
const TransactionHistory = require('../models/TransactionHistory');
const CreditWallet = require('../models/CreditWallet');

const userId = process.argv[2];

if (!userId) {
  console.error('❌ userId required\nUsage: node scripts/seedTransactions.js <userId>');
  process.exit(1);
}

const transactions = [
  {
    type: 'earning',
    amount: 500,
    description: 'Earned from campaign completion',
    referenceType: 'campaign',
    referenceId: 'camp001',
    status: 'completed',
    meta: { campaignId: 'camp001', reason: '' },
    daysAgo: 1,
  },
  {
    type: 'campaign_reward',
    amount: 300,
    description: 'Campaign reward - Diwali Sale Campaign',
    referenceType: 'campaign',
    referenceId: 'camp002',
    status: 'completed',
    meta: { campaignId: 'camp002', reason: '' },
    daysAgo: 3,
  },
  {
    type: 'bonus',
    amount: 200,
    description: 'Performance bonus - Top creator this week',
    referenceType: 'manual',
    referenceId: '',
    status: 'completed',
    meta: { reason: 'Top performer', approvedBy: 'admin' },
    daysAgo: 5,
  },
  {
    type: 'earning',
    amount: 150,
    description: 'Earned from reel task submission',
    referenceType: 'task',
    referenceId: 'task001',
    status: 'completed',
    meta: { taskId: 'task001', reason: '' },
    daysAgo: 7,
  },
  {
    type: 'penalty',
    amount: -100,
    description: 'Late submission penalty',
    referenceType: 'task',
    referenceId: 'task002',
    status: 'completed',
    meta: { taskId: 'task002', reason: 'Submitted after deadline' },
    daysAgo: 10,
  },
  {
    type: 'earning',
    amount: 400,
    description: 'Earned from Instagram post task',
    referenceType: 'task',
    referenceId: 'task003',
    status: 'completed',
    meta: { taskId: 'task003', reason: '' },
    daysAgo: 12,
  },
  {
    type: 'refund',
    amount: 100,
    description: 'Refund for rejected campaign',
    referenceType: 'campaign',
    referenceId: 'camp003',
    status: 'completed',
    meta: { campaignId: 'camp003', reason: 'Campaign cancelled' },
    daysAgo: 15,
  },
  {
    type: 'earning',
    amount: 250,
    description: 'Earned from YouTube shorts task',
    referenceType: 'task',
    referenceId: 'task004',
    status: 'completed',
    meta: { taskId: 'task004', reason: '' },
    daysAgo: 18,
  },
  {
    type: 'penalty',
    amount: -50,
    description: 'Low quality content penalty',
    referenceType: 'task',
    referenceId: 'task005',
    status: 'completed',
    meta: { taskId: 'task005', reason: 'Content did not meet guidelines' },
    daysAgo: 20,
  },
  {
    type: 'campaign_reward',
    amount: 600,
    description: 'Campaign reward - Brand Awareness Drive',
    referenceType: 'campaign',
    referenceId: 'camp004',
    status: 'completed',
    meta: { campaignId: 'camp004', reason: '' },
    daysAgo: 25,
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ MongoDB connected');

  // Calculate running balance
  let balance = 0;
  const docs = transactions.map((tx) => {
    balance += tx.amount;
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - tx.daysAgo);
    return {
      userId,
      type: tx.type,
      amount: tx.amount,
      description: tx.description,
      referenceType: tx.referenceType,
      referenceId: tx.referenceId,
      status: tx.status,
      meta: tx.meta,
      balanceAfter: balance,
      createdAt,
    };
  });

  await TransactionHistory.insertMany(docs);
  console.log(`✅ ${docs.length} transactions inserted for userId: ${userId}`);

  // Update or create wallet
  await CreditWallet.findOneAndUpdate(
    { userId },
    { $set: { totalBalance: balance } },
    { upsert: true }
  );
  console.log(`✅ Wallet updated — totalBalance: ${balance}`);

  await mongoose.disconnect();
  console.log('✅ Done!');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
