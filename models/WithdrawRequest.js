const mongoose = require('mongoose');

const withdrawSchema = new mongoose.Schema({
  userId:          { type: String, required: true, index: true },
  amount:          { type: Number, required: true },
  method:          { type: String, enum: ['bank', 'upi'], required: true },
  // Snapshot of payment details at time of request
  bankName:       { type: String, default: '' },
  accountNumber:  { type: String, default: '' },
  ifscCode:       { type: String, default: '' },
  accountHolder:  { type: String, default: '' },
  upiId:          { type: String, default: '' },
  // Status lifecycle
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'rejected'],
    default: 'pending',
  },
  transactionId:   { type: String, default: '' },
  rejectionReason: { type: String, default: '' },
  processedAt:     { type: Date, default: null },
  processedBy:     { type: String, default: '' }, // admin id
  note:            { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.WithdrawRequest || mongoose.model('WithdrawRequest', withdrawSchema);
