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
        validate: {
          validator: function(v) {
            // Password is required only if not using Google auth
            if (!this.googleId && !v) return false;
            return true;
          },
          message: 'Password is required for non-Google users'
        }
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
        unique: true,
        sparse: true,
        validate: {
          validator: function(v) {
            // GST is required only if not using Google auth
            if (!this.googleId && !v) return false;
            return true;
          },
          message: 'GST number is required for non-Google users'
        }
      },
      panNo: {
        type: String,
        unique: true,
        sparse: true,
        validate: {
          validator: function(v) {
            // PAN is required only if not using Google auth
            if (!this.googleId && !v) return false;
            return true;
          },
          message: 'PAN number is required for non-Google users'
        }
      },
      aadharNo: {
        type: String,
        unique: true,
        sparse: true,
        validate: {
          validator: function(v) {
            // Aadhar is required only if not using Google auth
            if (!this.googleId && !v) return false;
            return true;
          },
          message: 'Aadhar number is required for non-Google users'
        }
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
// Compound index for efficient queries (email and googleId already have unique indexes)
userSchema.index({ email: 1, googleId: 1 });

const User = mongoose.model("User", userSchema);
module.exports = User;
