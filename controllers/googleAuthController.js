const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Client = require("../models/client");

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
const verifyUser = async (req, res) => {
  try {
    const { googleUser } = req;
    if (!googleUser) {
      return res.status(400).json({
        success: false,
        message: "Google user information is required",
      });
    }

    const { email, name, picture, emailVerified, googleToken } = googleUser;

    // Find client by email
    let client = await Client.findOne({ email });

    // If client doesn't exist, create a new one from Google info
    if (!client) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(
        Math.random().toString(36).slice(-8),
        salt
      );

      client = await Client.create({
        name: name || email.split("@")[0],
        email,
        password: hashedPassword,
        isGoogleUser: true,
        googlePicture: picture,
        emailVerified: emailVerified,
        businessName: name ? `${name}'s Business` : "Google User Business",
        gstNo: "GOOGLE" + Date.now(),
        panNo: "GOOGLE" + Date.now(),
        aadharNo: "GOOGLE" + Date.now(),
        city: "Unknown",
        pincode: "000000",
      });
    }

    // Generate our own JWT token for session management
    const authToken = generateToken(client._id);

    // If we reach here, the Google token is valid and user is in our system
    return res.status(200).json({
      success: true,
      message: "User verified successfully",
      authToken: authToken, // Your application's session token
      email: client.email,
      name: client.name,
      emailVerified: client.emailVerified,
      googleToken: googleToken, // The original Google token
    });
  } catch (error) {
    console.error("Google verification error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred during verification",
    });
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
  verifyUser,
  completeProfile,
  getProfile,
  updateProfile
}; 