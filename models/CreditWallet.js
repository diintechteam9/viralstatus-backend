const mongoose = require('mongoose');

const CreditWalletSchema = new mongoose.Schema({
  userId:           { type: String, required: true, unique: true },
  totalBalance:     { type: Number, default: 0 },     // approved credits available
  pendingCredits:   { type: Number, default: 0 },     // awaiting approval
  acceptedCredits:  { type: Number, default: 0 },     // total ever approved
  rejectedCredits:  { type: Number, default: 0 },     // rejected
  totalCampaigns:   { type: Number, default: 0 },
  // Withdrawal tracking
  totalWithdrawn:   { type: Number, default: 0 },     // total successfully withdrawn
  pendingWithdraw:  { type: Number, default: 0 },     // withdrawal request in processing
  kycVerified:      { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('CreditWallet', CreditWalletSchema);
