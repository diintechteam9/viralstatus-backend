const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Name is required"],
      },
      email: {
        type: String,
        required: [true, "Email is required"],
        unique: true,
      },
      password: {
        type: String,
        required: function() {
          // Password is required only if not using Google auth
          return !this.googleId;
        },
      },
      // Google Authentication fields
      googleId: {
        type: String,
        unique: true,
        sparse: true, // Allows multiple null values
      },
      googlePicture: {
        type: String,
      },
      isGoogleUser: {
        type: Boolean,
        default: false,
      },
      emailVerified: {
        type: Boolean,
        default: false,
      },
      // Business fields (optional for Google users)
      businessName: {
        type: String,
        
      },
      gstNo: {
        type: String,
        required: function() {
          return !this.googleId;
        },
        unique: true,
        sparse: true,
      },
      panNo: {
        type: String,
        required: function() {
          return !this.googleId;
        },
        unique: true,
        sparse: true,
      },
      aadharNo: {
        type: String,
        required: function() {
          return !this.googleId;
        },
        unique: true,
        sparse: true,
      },
      city: {
        type: String,
        
      },
      pincode: {
        type: String,
      },
      websiteUrl: {
        type: String,
      },
      // Profile completion status
      isProfileCompleted: {
        type: Boolean,
        default: false,
      },
      isClient:{
        type: Boolean,
        default: false,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
      lastLoginAt: {
        type: Date,
        default: Date.now,
      },
});
// Index for efficient queries
userSchema.index({ email: 1 });
userSchema.index({ googleId: 1 });
userSchema.index({ email: 1, googleId: 1 });

const User = mongoose.model("User", userSchema);
module.exports = User;
