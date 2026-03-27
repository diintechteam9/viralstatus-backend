const mongoose = require('mongoose');
const { customAlphabet } = require('nanoid');

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 6);

const clientSchema = new mongoose.Schema({
  clientId: { type: String, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  businessName: { type: String, required: true },
  contactPerson: { type: String },
  phone: { type: String },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

// Auto-generate CLI-XXXXXX before save
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
