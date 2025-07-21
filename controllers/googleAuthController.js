const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Client = require("../models/client");
const User = require("../models/user");
const { OAuth2Client } = require('google-auth-library');
const { USER_REFRESH_ACCOUNT_TYPE } = require("google-auth-library/build/src/auth/refreshclient");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// const CreditWallet = require('../models/CreditWallet');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

/**
 * Verify Google user and return success if token is valid
 * This is now a pure verification endpoint
 */
const verifyUserOrClient = async (req, res) => {
  try {
    // Log incoming googleUser and role for debugging
    console.error('verifyUserOrClient: req.googleUser:', req.googleUser);
    const { googleUser } = req;
    // const { role } = req.body; // 'user' or 'client'

    // if (!googleUser || !role) {
    //   return res.status(400).json({ success: false, message: "Google user info and role are required" });
    // }

    const { email, name, picture, emailVerified, googleId } = googleUser;

    let Model = User;
    // if (role === "user") {
    //   Model = User;
    // } else if (role === "client") {
    //   Model = Client;
    // } else {
    //   return res.status(400).json({ success: false, message: "Invalid role" });
    // }
    


    // Find or create user/client
    let entity = await Model.findOne({ email });
    if (!entity) {
      entity = await Model.create({
        name: name || email.split("@")[0],
        email,
        isGoogleUser: true,
        googleId: googleId,
        googlePicture: picture,
        emailVerified: emailVerified,
        isClient:false,
        password: "", // No password for Google users
      });
    }

    const authToken = generateToken(entity._id);
    const MongoId = entity._id;

    return res.status(200).json({
      success: true,
      message: "Verified successfully",
      authToken,
      MongoId,
      isClient: entity.isClient,
      email: entity.email,
      name: entity.name,
      emailVerified: entity.emailVerified,
      isProfileCompleted: true, // or your own logic
      googleId: entity.googleId,
    });
  } catch (error) {
    console.error('verifyUserOrClient error:', error && error.stack ? error.stack : error);
    res.status(500).json({ success: false, message: error.message || "An error occurred during verification", error: error && error.message ? error.message : error });
  }
};

/**
 * Complete profile for Google users
 * This allows Google users to add their business information
 */
const completeProfile = async (req, res) => {
  try {
    const { user } = req;
    const {
      businessName,
      gstNo,
      panNo,
      aadharNo,
      city,
      pincode,
      websiteUrl
    } = req.body;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Check if user is a Google user
    if (!user.isGoogleUser) {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is only for Google users'
      });
    }

    // Validate required fields
    if (!businessName || !gstNo || !panNo || !aadharNo || !city || !pincode) {
      return res.status(400).json({
        success: false,
        message: 'All business fields are required'
      });
    }

    // Check if GST/PAN/Aadhar numbers are already taken
    const existingClient = await Client.findOne({
      _id: { $ne: user._id },
      $or: [
        { gstNo },
        { panNo },
        { aadharNo }
      ]
    });

    if (existingClient) {
      return res.status(400).json({
        success: false,
        message: 'Business details already exist with the same GST, PAN, or Aadhar number'
      });
    }

    // Update user profile
    const updatedClient = await Client.findByIdAndUpdate(
      user._id,
      {
        businessName,
        gstNo,
        panNo,
        aadharNo,
        city,
        pincode,
        websiteUrl,
        isProfileCompleted: true
      },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Profile completed successfully',
      user: {
        _id: updatedClient._id,
        name: updatedClient.name,
        email: updatedClient.email,
        googlePicture: updatedClient.googlePicture,
        isGoogleUser: updatedClient.isGoogleUser,
        emailVerified: updatedClient.emailVerified,
        isProfileCompleted: updatedClient.isProfileCompleted,
        businessName: updatedClient.businessName,
        gstNo: updatedClient.gstNo,
        panNo: updatedClient.panNo,
        aadharNo: updatedClient.aadharNo,
        city: updatedClient.city,
        pincode: updatedClient.pincode,
        websiteUrl: updatedClient.websiteUrl,
        createdAt: updatedClient.createdAt,
        lastLoginAt: updatedClient.lastLoginAt
      }
    });

  } catch (error) {
    console.error('Profile completion error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while completing profile'
    });
  }
};

/**
 * Get current user profile
 */
const getProfile = async (req, res) => {
  try {
    const { user } = req;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        googlePicture: user.googlePicture,
        isGoogleUser: user.isGoogleUser,
        emailVerified: user.emailVerified,
        isProfileCompleted: user.isProfileCompleted,
        businessName: user.businessName,
        gstNo: user.gstNo,
        panNo: user.panNo,
        aadharNo: user.aadharNo,
        city: user.city,
        pincode: user.pincode,
        websiteUrl: user.websiteUrl,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while fetching profile'
    });
  }
};

/**
 * Update user profile
 */
const updateProfile = async (req, res) => {
  try {
    const { user } = req;
    const updateData = req.body;
  

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Remove sensitive fields that shouldn't be updated
    delete updateData.password;
    delete updateData.googleId;
    delete updateData.email;
    delete updateData._id;

    const updatedClient = await Client.findByIdAndUpdate(
      user._id,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        _id: updatedClient._id,
        name: updatedClient.name,
        email: updatedClient.email,
        googlePicture: updatedClient.googlePicture,
        isGoogleUser: updatedClient.isGoogleUser,
        emailVerified: updatedClient.emailVerified,
        isProfileCompleted: updatedClient.isProfileCompleted,
        businessName: updatedClient.businessName,
        gstNo: updatedClient.gstNo,
        panNo: updatedClient.panNo,
        aadharNo: updatedClient.aadharNo,
        city: updatedClient.city,
        pincode: updatedClient.pincode,
        websiteUrl: updatedClient.websiteUrl,
        createdAt: updatedClient.createdAt,
        lastLoginAt: updatedClient.lastLoginAt
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while updating profile'
    });
  }
};

module.exports = {
  verifyUserOrClient,
  completeProfile,
  getProfile,
  updateProfile
}; 