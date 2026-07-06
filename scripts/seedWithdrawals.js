require('dotenv').config();
const mongoose = require('mongoose');
const WithdrawRequest = require('../models/WithdrawRequest');

const userId = '6a0d57922f3eb905bcbe5ece';

const withdrawals = [
  {
    amount: 500,
    method: 'upi',
    upiId: 'user@paytm',
    status: 'completed',
    transactionId: 'UTR123456789',
    daysAgo: 5,
  },
  {
    amount: 300,
    method: 'bank',
    bankName: 'SBI',
    accountNumber: '1234567890',
    ifscCode: 'SBIN0001234',
    accountHolder: 'Test User',
    status: 'completed',
    transactionId: 'UTR987654321',
    daysAgo: 15,
  },
  {
    amount: 200,
    method: 'upi',
    upiId: 'user@gpay',
    status: 'pending',
    transactionId: '',
    daysAgo: 1,
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ MongoDB connected');

  const docs = withdrawals.map((w) => {
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - w.daysAgo);
    return { userId, ...w, createdAt };
  });

  await WithdrawRequest.insertMany(docs);
  console.log(`✅ ${docs.length} withdrawals inserted for userId: ${userId}`);

  await mongoose.disconnect();
  console.log('✅ Done!');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
