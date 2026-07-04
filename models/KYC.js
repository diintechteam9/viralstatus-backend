const mongoose = require('mongoose');

const kycSchema = new mongoose.Schema({
  userId:      { type: String, required: true, unique: true, index: true },
  // Personal details
  fullName:    { type: String, default: '' },
  dateOfBirth: { type: String, default: '' },
  gender:      { type: String, enum: ['male', 'female', 'other', ''], default: '' },
  // Address
  address:     { type: String, default: '' },
  city:        { type: String, default: '' },
  state:       { type: String, default: '' },
  pincode:     { type: String, default: '' },
  // Bank details (for withdrawal)
  bankName:       { type: String, default: '' },
  accountNumber:  { type: String, default: '' },
  ifscCode:       { type: String, default: '' },
  accountHolder:  { type: String, default: '' },
  // UPI
  upiId: { type: String, default: '' },
  // Documents (R2 keys)
  panNumber:     { type: String, default: '' },
  panImageKey:   { type: String, default: '' },
  panImageUrl:   { type: String, default: '' },
  aadharNumber:  { type: String, default: '' },
  aadharFrontKey:{ type: String, default: '' },
  aadharFrontUrl:{ type: String, default: '' },
  aadharBackKey: { type: String, default: '' },
  aadharBackUrl: { type: String, default: '' },
  selfieKey:     { type: String, default: '' },
  selfieUrl:     { type: String, default: '' },
  // Status
  status: {
    type: String,
    enum: ['pending', 'submitted', 'under_review', 'approved', 'rejected'],
    default: 'pending',
  },
  rejectionReason: { type: String, default: '' },
  submittedAt:     { type: Date, default: null },
  reviewedAt:      { type: Date, default: null },
  reviewedBy:      { type: String, default: '' }, // admin id
}, { timestamps: true });

module.exports = mongoose.models.KYC || mongoose.model('KYC', kycSchema);
