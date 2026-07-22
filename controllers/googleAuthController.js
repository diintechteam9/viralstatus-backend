const jwt = require("jsonwebtoken");
const Client = require("../models/client");
const User = require("../models/user");
const TelegramServiceController = require('./telegram/telegrambotalertcontroller');
const telegramService = new TelegramServiceController();
const TelegramSettings = require('../models/Settings');
const { logGoogleAuthAttempt, logGoogleAuthError } = require('../utils/googleAuthLogger');

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
    console.log('verifyUserOrClient: req.googleUser:', req.googleUser);
    const { googleUser } = req;

    const { email, name, picture, emailVerified, googleId } = googleUser;

    // Default to 'user'; if explicitly called from client login, expect role: 'client'
    const role = (req.body && typeof req.body.role === 'string') ? req.body.role.toLowerCase() : 'user';

    let Model;
    if (role === 'client') {
      Model = Client;
    } else if (role === 'user') {
      Model = User;
    } else {
      return res.status(400).json({ success: false, message: "Invalid role" });
    }
    

    // Find or create user/client
    let entity = await Model.findOne({ email });
    let isNewEntity = false;
    if (!entity) {
      const baseDoc = {
        name: name || email.split("@")[0],
        email,
        isGoogleUser: true,
        googleId: googleId,
        googlePicture: picture,
        emailVerified: emailVerified,
        isProfileCompleted: false,
        password: "",
      };
      if (Model === User) {
        baseDoc.isClient = false;
      }
      try {
        entity = await Model.create(baseDoc);
        isNewEntity = true;
      } catch (createError) {
        // Handle duplicate key or validation errors
        if (createError.code === 11000) {
          const field = Object.keys(createError.keyPattern)[0];
          console.error(`Duplicate key error on field: ${field}`);
          // Try to find and update existing document
          entity = await Model.findOne({ [field]: createError.keyValue[field] });
          if (entity) {
            entity.googlePicture = picture || entity.googlePicture;
            entity.emailVerified = emailVerified;
            entity.lastLoginAt = new Date();
            await entity.save();
          } else {
            throw new Error(`Failed to create or find user with ${field}: ${createError.keyValue[field]}`);
          }
        } else if (createError.name === 'ValidationError') {
          const errors = Object.values(createError.errors).map(e => e.message);
          throw new Error(`Validation failed: ${errors.join(', ')}`);
        } else {
          throw createError;
        }
      }
    } else {
      // Update login metadata
      entity.googlePicture = picture || entity.googlePicture;
      entity.emailVerified = emailVerified;
      entity.lastLoginAt = new Date();
      try {
        await entity.save();
      } catch (saveError) {
        if (saveError.name === 'ValidationError') {
          const errors = Object.values(saveError.errors).map(e => e.message);
          throw new Error(`Failed to update user: ${errors.join(', ')}`);
        }
        throw saveError;
      }
    }

    const authToken = generateToken(entity._id);
    const MongoId = entity._id;

    logGoogleAuthAttempt(email, role, 'success', { isNewEntity, userId: MongoId });

    // Send Telegram alert for newly created Google user/client if enabled
    if (isNewEntity) {
      let allowAlert = true;
      try {
        const settings = await TelegramSettings.findOne();
        if (settings && settings.telegramAlertsEnabledOnRegistration === false) {
          allowAlert = false;
        }
      } catch (_) {}
      if (allowAlert) {
      const roleLabel = (Model === Client) ? 'Client' : 'User';
      const loginTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const message = `🆕 <b>New ${roleLabel} Registered</b>\n\n` +
        `🧑💼 <b>Name:</b> ${entity.name || '-'}\n` +
        `✉️ <b>Email:</b> ${entity.email || '-'}\n` +
        `⏰ <b>Time:</b> ${loginTime}`;
      try {
        await telegramService.sendTextMessage(message);
      } catch (e) {
        console.error('Failed to send Telegram alert for Google signup:', e && e.message ? e.message : e);
      }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Verified successfully",
      authToken,
      MongoId,
      isClient: role === 'client',
      email: entity.email,
      name: entity.name,
      emailVerified: entity.emailVerified,
      isProfileCompleted: entity.isProfileCompleted,
      googleId: entity.googleId,
    });
  } catch (error) {
    console.error('verifyUserOrClient error:', error && error.stack ? error.stack : error);
    logGoogleAuthError(googleUser?.email || 'unknown', error, { role });
    
    // Determine error type and send appropriate message
    let statusCode = 500;
    let message = 'An error occurred during verification';
    
    if (error.message?.includes('internet') || error.message?.includes('connection')) {
      statusCode = 503;
      message = 'Network error. Please check your internet connection.';
    } else if (error.message?.includes('Validation failed')) {
      statusCode = 400;
      message = error.message;
    } else if (error.message?.includes('duplicate') || error.code === 11000) {
      statusCode = 409;
      message = 'Email already registered. Please use a different email or sign in.';
    }
    
    return res.status(statusCode).json({ 
      success: false, 
      message: message,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
    if (!businessName || !gstNo || !panNo || !city || !pincode) {
      return res.status(400).json({
        success: false,
        message: 'All business fields are required'
      });
    }

    // Check if GST/PAN numbers are already taken
    const existingClient = await Client.findOne({
      _id: { $ne: user._id },
      $or: [
        { gstNo },
        { panNo }
      ]
    });

    if (existingClient) {
      return res.status(400).json({
        success: false,
        message: 'Business details already exist with the same GST or PAN number'
      });
    }

    // Try to update in User collection first, then Client
    let updatedClient = await User.findByIdAndUpdate(
      user._id,
      {
        businessName,
        gstNo,
        panNo,
        city,
        pincode,
        websiteUrl,
        isProfileCompleted: true
      },
      { new: true, runValidators: true }
    );

    // If not found in User, try Client
    if (!updatedClient) {
      updatedClient = await Client.findByIdAndUpdate(
        user._id,
        {
          businessName,
          gstNo,
          panNo,
          city,
          pincode,
          websiteUrl,
          isProfileCompleted: true
        },
        { new: true, runValidators: true }
      );
    }

    if (!updatedClient) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Send Telegram alert for completed profile after Google login if enabled
    try {
      let allowAlert = true;
      try {
        const settings = await TelegramSettings.findOne();
        if (settings && settings.telegramAlertsEnabledOnProfileCreated === false) {
          allowAlert = false;
        }
      } catch (_) {}
      if (allowAlert) {
      const loginTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const message = `📄 <b>New Profile Created</b>\n\n` +
        `🧑💼 <b>Name:</b> ${updatedClient.name || '-'}\n` +
        `✉️ <b>Email:</b> ${updatedClient.email || '-'}\n` +
        `🏢 <b>Business:</b> ${updatedClient.businessName || '-'}\n` +
        `🌆 <b>City:</b> ${updatedClient.city || '-'}\n` +
        `📦 <b>Pincode:</b> ${updatedClient.pincode || '-'}\n` +
        `🔗 <b>Website:</b> ${updatedClient.websiteUrl || '-'}\n` +
        `⏰ <b>Time:</b> ${loginTime}`;
      await telegramService.sendTextMessage(message);
      }
    } catch (e) {
      console.error('Failed to send Telegram alert for profile completion:', e && e.message ? e.message : e);
    }

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
        city: updatedClient.city,
        pincode: updatedClient.pincode,
        websiteUrl: updatedClient.websiteUrl,
        createdAt: updatedClient.createdAt,
        lastLoginAt: updatedClient.lastLoginAt
      }
    });

  } catch (error) {
    console.error('Profile completion error:', error);
    logGoogleAuthError(user?.email || 'unknown', error, { action: 'completeProfile' });
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

    // Try to update in User collection first, then Client
    let updatedClient = await User.findByIdAndUpdate(
      user._id,
      updateData,
      { new: true, runValidators: true }
    );

    // If not found in User, try Client
    if (!updatedClient) {
      updatedClient = await Client.findByIdAndUpdate(
        user._id,
        updateData,
        { new: true, runValidators: true }
      );
    }

    if (!updatedClient) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

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
        city: updatedClient.city,
        pincode: updatedClient.pincode,
        websiteUrl: updatedClient.websiteUrl,
        createdAt: updatedClient.createdAt,
        lastLoginAt: updatedClient.lastLoginAt
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    logGoogleAuthError(user?.email || 'unknown', error, { action: 'updateProfile' });
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
