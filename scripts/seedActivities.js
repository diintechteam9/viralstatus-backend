require('dotenv').config();
const mongoose = require('mongoose');
const Activity = require('../models/Activity');

const activities = [
  { actorId: 'user001', actorName: 'Rahul Sharma', type: 'user_joined', description: 'Rahul Sharma joined the platform', daysAgo: 1 },
  { actorId: 'user002', actorName: 'Priya Singh', type: 'user_joined', description: 'Priya Singh joined the platform', daysAgo: 1 },
  { actorId: 'user003', actorName: 'Amit Kumar', type: 'user_joined', description: 'Amit Kumar joined the platform', daysAgo: 2 },
  { actorId: 'user004', actorName: 'Sneha Patel', type: 'user_joined', description: 'Sneha Patel joined the platform', daysAgo: 2 },
  { actorId: 'user005', actorName: 'Vikram Rao', type: 'user_joined', description: 'Vikram Rao joined the platform', daysAgo: 3 },
  { actorId: 'user001', actorName: 'Rahul Sharma', type: 'campaign_joined', description: 'Rahul Sharma joined Diwali Sale Campaign', daysAgo: 1, meta: { campaignName: 'Diwali Sale Campaign' } },
  { actorId: 'user002', actorName: 'Priya Singh', type: 'campaign_joined', description: 'Priya Singh joined Brand Awareness Drive', daysAgo: 2, meta: { campaignName: 'Brand Awareness Drive' } },
  { actorId: 'user003', actorName: 'Amit Kumar', type: 'task_completed', description: 'Amit Kumar completed Instagram post task', daysAgo: 2, meta: { campaignName: 'Summer Sale', credits: 150 } },
  { actorId: 'user004', actorName: 'Sneha Patel', type: 'credits_earned', description: 'Sneha Patel earned 300 credits', daysAgo: 3, meta: { credits: 300, amount: 300 } },
  { actorId: 'user005', actorName: 'Vikram Rao', type: 'campaign_completed', description: 'Vikram Rao completed Diwali Sale Campaign', daysAgo: 3, meta: { campaignName: 'Diwali Sale Campaign', credits: 500 } },
  { actorId: 'user001', actorName: 'Rahul Sharma', type: 'kyc_submitted', description: 'Rahul Sharma submitted KYC documents', daysAgo: 4 },
  { actorId: 'user002', actorName: 'Priya Singh', type: 'kyc_approved', description: 'Priya Singh KYC approved', daysAgo: 4 },
  { actorId: 'user003', actorName: 'Amit Kumar', type: 'withdrawal_request', description: 'Amit Kumar requested withdrawal of 500 credits', daysAgo: 5, meta: { amount: 500, credits: 500 } },
  { actorId: 'user004', actorName: 'Sneha Patel', type: 'ugc_submitted', description: 'Sneha Patel uploaded UGC video', daysAgo: 5, meta: { campaignName: 'Brand Awareness Drive' } },
  { actorId: 'user005', actorName: 'Vikram Rao', type: 'review_posted', description: 'Vikram Rao posted a testimonial', daysAgo: 6 },
  { actorId: 'user001', actorName: 'Rahul Sharma', type: 'withdrawal_paid', description: 'Rahul Sharma withdrawal of 300 credits completed', daysAgo: 6, meta: { amount: 300, credits: 300 } },
  { actorId: 'user006', actorName: 'Neha Gupta', type: 'user_joined', description: 'Neha Gupta joined the platform', daysAgo: 7 },
  { actorId: 'user007', actorName: 'Rohan Mehta', type: 'user_joined', description: 'Rohan Mehta joined the platform', daysAgo: 7 },
  { actorId: 'user006', actorName: 'Neha Gupta', type: 'task_accepted', description: 'Neha Gupta accepted YouTube shorts task', daysAgo: 7, meta: { campaignName: 'YouTube Growth Campaign' } },
  { actorId: 'user007', actorName: 'Rohan Mehta', type: 'credits_earned', description: 'Rohan Mehta earned 250 credits', daysAgo: 8, meta: { credits: 250, amount: 250 } },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ MongoDB connected');

  const docs = activities.map((a) => {
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - a.daysAgo);
    return {
      actorId: a.actorId,
      actorName: a.actorName,
      actorRole: 'user',
      type: a.type,
      description: a.description,
      meta: a.meta || {},
      createdAt,
    };
  });

  await Activity.insertMany(docs);
  console.log(`✅ ${docs.length} activities inserted`);

  await mongoose.disconnect();
  console.log('✅ Done!');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
