const User = require("../models/user");
const bcrypt = require("bcryptjs");
const jwt = require('jsonwebtoken');
const CreditWallet = require('../models/CreditWallet');


// Generate JWT Token for admin
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });
};

const loginUser = async (req, res) => {
  try {
    const { email, password, token, name, googleAuth } = req.body;

    // Google Authentication
    if (googleAuth && email) {
      console.log('Google auth login attempt for user with email:', email);
      let user = await User.findOne({ email });
      if (!user) {
        console.log('Creating new user from Google auth for:', email);
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(Math.random().toString(36).slice(-8), salt);
        user = await User.create({
          name: name || email.split('@')[0],
          email,
          password: hashedPassword,
          businessName: '',
          gstNo: "GOOGLE" + Date.now(),
          panNo: "GOOGLE" + Date.now(),
          aadharNo: "GOOGLE" + Date.now(),
          city: "",
          pincode: "",
        });
        console.log('New Google-authenticated user created:', user._id);
      }
      // Ensure CreditWallet exists for this user
      const wallet = await CreditWallet.findOne({ userId: user._id });
      if (!wallet) {
        await CreditWallet.create({ userId: user._id });
      }
      const authToken = generateToken(user._id);
      console.log('Google login successful for user:', email);
      return res.status(200).json({
        success: true,
        token: authToken,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          businessName: user.businessName,
          gstNo: user.gstNo,
          panNo: user.panNo,
          aadharNo: user.aadharNo,
          city: user.city,
          pincode: user.pincode,
          websiteUrl: user.websiteUrl
        }
      });
    }

    // Regular email/password login
    if (!email || !password) {
      console.log('Missing credentials');
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }
    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found for email:', email);
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log('Invalid password for user email:', email);
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }
    // Ensure CreditWallet exists for this user
    const wallet = await CreditWallet.findOne({ userId: user._id });
    if (!wallet) {
      await CreditWallet.create({ userId: user._id });
    }
    const jwtToken = generateToken(user._id);
    console.log('Login successful for user email:', email);
    res.status(200).json({
      success: true,
      token: jwtToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        businessName: user.businessName,
        gstNo: user.gstNo,
        panNo: user.panNo,
        aadharNo: user.aadharNo,
        city: user.city,
        pincode: user.pincode,
        websiteUrl: user.websiteUrl
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: error.message || "An error occurred during login"
    });
  }
};

const registerUser = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      businessName,
      gstNo,
      panNo,
      aadharNo,
      city,
      pincode,
      websiteUrl
    } = req.body;

    // Check if user email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already registered"
      });
    }

    // Check if user already exists with the same GST/PAN/Aadhar
    const existingBusinessUser = await User.findOne({
      $or: [
        { gstNo },
        { panNo },
        { aadharNo }
      ]
    });
    if (existingBusinessUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with the same GST, PAN, or Aadhar number"
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      businessName,
      gstNo,
      panNo,
      aadharNo,
      city,
      pincode,
      websiteUrl
    });

    // Ensure CreditWallet exists for this user
    await CreditWallet.create({ userId: user._id });

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

module.exports = { loginUser, registerUser };