const mongoose = require('mongoose');

const transactionHistorySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  
  // Transaction type: earning, penalty, bonus, refund, etc.
  type: {
    type: String,
    enum: ['earning', 'penalty', 'bonus', 'refund', 'adjustment', 'campaign_reward'],
    required: true,
  },
  
  // Amount (positive for credit, negative for debit)
  amount: { type: Number, required: true },
  
  // Description of transaction
  description: { type: String, default: '' },
  
  // Reference to related entity
  referenceType: { type: String, enum: ['campaign', 'task', 'submission', 'manual', 'system'], default: 'manual' },
  referenceId: { type: String, default: '' },
  
  // Status
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed'],
    default: 'completed',
  },
  
  // Metadata
  meta: {
    campaignId: { type: String, default: '' },
    taskId: { type: String, default: '' },
    submissionId: { type: String, default: '' },
    reason: { type: String, default: '' }, // for penalties: reason for penalty
    approvedBy: { type: String, default: '' }, // admin id who approved
  },
  
  // Balance snapshot after transaction
  balanceAfter: { type: Number, default: 0 },
  
  createdAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

// Index for efficient queries
transactionHistorySchema.index({ userId: 1, createdAt: -1 });
transactionHistorySchema.index({ userId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('TransactionHistory', transactionHistorySchema);
