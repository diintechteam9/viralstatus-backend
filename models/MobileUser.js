const mongoose = require('mongoose');

const mobileUserSchema = new mongoose.Schema({
  email: { type: String, required: true },
  password: { type: String },
  name: { type: String },
  mobile: { type: String },
  mobileNumber: { type: String },
  city: { type: String },
  pincode: { type: String },
  businessName: { type: String },
  gender: { type: String },
  ageRange: { type: String },
  businessInterests: [{ type: String }],
  occupation: { type: String },
  highestQualification: { type: String },
  fieldOfStudy: { type: String },
  skills: [{ type: String }],
  socialMedia: {
    instagram: { handle: { type: String }, followersCount: { type: String } },
    youtube: { channelUrl: { type: String }, subscribers: { type: String } },
  },
  profileImage: { type: String },

  // Auth
  googleId: { type: String, sparse: true },
  firebaseUid: { type: String, sparse: true },
  isGoogleUser: { type: Boolean, default: false },
  isFirebaseUser: { type: Boolean, default: false },

  // Verification flags
  emailVerified: { type: Boolean, default: false },
  mobileVerified: { type: Boolean, default: false },
  profileCompleted: { type: Boolean, default: false },

  // 0=init, 1=email verified, 2=mobile verified, 3=complete
  registrationStep: { type: Number, default: 0 },

  // OTP
  emailOtp: { type: String },
  emailOtpExpiry: { type: Date },
  mobileOtp: { type: String },
  mobileOtpExpiry: { type: Date },
  otpMethod: { type: String, enum: ['gupshup', 'twilio', 'whatsapp'], default: 'gupshup' },

  // Password Reset OTP
  resetOtp: { type: String },
  resetOtpExpiry: { type: Date },
  resetOtpVerified: { type: Boolean, default: false },

  // Profile Image (R2 key)
  profileImageKey: { type: String },
  profileImageUrl: { type: String },

  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  clientCode: { type: String },  // CLI-XXXXXX string copy
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date, default: Date.now },
});

mobileUserSchema.index({ email: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model('MobileUser', mobileUserSchema);
