const mongoose = require('mongoose');

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const nanoid = () => Array.from({ length: 6 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');

const clientSchema = new mongoose.Schema({
  clientId: { type: String, unique: true },
  name: { type: String, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  businessName: { type: String, required: true, trim: true },
  contactPerson: { type: String, trim: true },
  phone: { type: String, trim: true },
  websiteUrl: { type: String, trim: true },
  city: { type: String, trim: true },
  pincode: { type: String, trim: true },
  gstNo: { type: String, trim: true },
  panNo: { type: String, trim: true },
  aadharNo: { type: String, trim: true },
  businessLogoKey: { type: String, trim: true },
  businessLogoUrl: { type: String, trim: true },
  filter: {
    type: String,
    enum: ['all', 'new', 'prime', 'demo', 'in-house', 'testing', 'rejected'],
    default: 'new',
    lowercase: true,
    trim: true,
  },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

clientSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  if (!this.name && this.contactPerson) {
    this.name = this.contactPerson;
  }
  next();
});

clientSchema.pre('validate', async function (next) {
  if (!this.clientId) {
    let unique = false;
    while (!unique) {
      const generated = 'CLI-' + nanoid();
      const exists = await mongoose.model('Client').findOne({ clientId: generated });
      if (!exists) {
        this.clientId = generated;
        unique = true;
      }
    }
  }
  next();
});

module.exports = mongoose.model('Client', clientSchema);
