const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const appClientSchema = new mongoose.Schema(
  {
    appId: { type: mongoose.Schema.Types.ObjectId, ref: 'App', required: true, index: true },
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true, default: '' },
    logoKey: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
    websiteUrl: { type: String, trim: true, default: '' },
    email: { type: String, required: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    mobile: { type: String, trim: true, default: '' },
    gstNumber: { type: String, trim: true, default: '' },
    panNumber: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    pincode: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

appClientSchema.index({ appId: 1, email: 1 }, { unique: true });

appClientSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

appClientSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.models.AppClient || mongoose.model('AppClient', appClientSchema);
