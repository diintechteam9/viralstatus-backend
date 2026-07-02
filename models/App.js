const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const appSchema = new mongoose.Schema(
  {
    businessName: { type: String, required: true, trim: true },
    websiteUrl: { type: String, trim: true, default: '' },
    gstNumber: { type: String, trim: true, default: '' },
    panNumber: { type: String, trim: true, default: '' },
    logoKey: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
    fullName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    mobile: { type: String, required: true, trim: true },
    city: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    pincode: { type: String, trim: true, default: '' },
    app: { type: String, trim: true, default: '' },
    password: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

appSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

appSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.models.App || mongoose.model('App', appSchema);
