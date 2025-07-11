const mongoose = require('mongoose');

const CreditWalletSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true }, 
  totalBalance: { type: Number, default: 0 },              
  pendingCredits: { type: Number, default: 0 },            
  acceptedCredits: { type: Number, default: 0 },           
  rejectedCredits: { type: Number, default: 0 },           
  totalCampaigns: { type: Number, default: 0 },            
}, {
  timestamps: true
});

module.exports = mongoose.model('CreditWallet', CreditWalletSchema); 