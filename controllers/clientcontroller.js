const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Client = require("../models/client");

// Generate JWT Token for admin
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

// // Login client
const loginClient = async (req, res) => {
    try {
      const { email, password, token, name, googleAuth} = req.body;
  
      // Google Authentication
      if (googleAuth && email) {
        console.log('Google auth login attempt for client with email:', email);
        
        // Find client by email
        let client = await Client.findOne({ email });
        
        // If client doesn't exist but is using Google auth, create a new one
        if (!client) {
          console.log('Creating new client from Google auth for:', email);
          
          // Create a random password for Google auth users
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(Math.random().toString(36).slice(-8), salt);
          
          // Create new client with basic details from Google
          client = await Client.create({
            name: name || email.split('@')[0],
            email,
            password: hashedPassword,
            businessName: name ? `${name}'s Business` : "Google User Business",
            gstNo: "GOOGLE" + Date.now(),
            panNo: "GOOGLE" + Date.now(),
            aadharNo: "GOOGLE" + Date.now(),
            city: "Unknown",
            pincode: "000000",
          });
          
          console.log('New Google-authenticated client created:', client._id);
        }
        
        // Generate JWT token
        const authToken = generateToken(client._id);
        
        console.log('Google login successful for client:', email);
        
        return res.status(200).json({
          success: true,
          token: authToken,
          client: {
            _id: client._id,
            name: client.name,
            email: client.email,
            businessName: client.businessName
          }
        });
      }
      
      // Regular email/password login
    //   console.log('Regular login attempt for client with email:', email);
  
      if (!email || !password) {
        console.log('Missing credentials');
        return res.status(400).json({
          success: false,
          message: "Email and password are required"
        });
      }
  
      // Check if client exists
      const client = await Client.findOne({ email });
      if (!client) {
        console.log('Client not found for email:', email);
        return res.status(401).json({ 
          success: false, 
          message: "Invalid email or password" 
        });
      }
  
  
      // Check if password matches
      const isPasswordValid = await bcrypt.compare(password, client.password);
      if (!isPasswordValid) {
        console.log('Invalid password for client email:', email);
        return res.status(401).json({ 
          success: false, 
          message: "Invalid email or password" 
        });
      }
  
  
      // Generate token
      const jwtToken = generateToken(client._id);
  
      console.log('Login successful for client email:', email);
  
      res.status(200).json({
        success: true,
        token: jwtToken,
        client: {
          _id: client._id,
          name: client.name,
          email: client.email,
          businessName: client.businessName,
          gstNo: client.gstNo,
          panNo: client.panNo,
          aadharNo: client.aadharNo,
          city: client.city,
          pincode: client.pincode,
          websiteUrl: client.websiteUrl
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
  
  // Register new client
  const registerClient = async (req, res) => {
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
  
      // Check if client email already exists
      const existingClient = await Client.findOne({ email });
      if (existingClient) {
        return res.status(400).json({
          success: false,
          message: "Email already registered"
        });
      }
  
      // Check if client already exists with the same GST/PAN/Aadhar
      const existingBusinessClient = await Client.findOne({
        $or: [
          { gstNo },
          { panNo },
          { aadharNo }
        ]
      });
  
      if (existingBusinessClient) {
        return res.status(400).json({
          success: false,
          message: "Client already exists with the same GST, PAN, or Aadhar number"
        });
      }
  
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
  
      // Create new client
      const client = await Client.create({
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
  
      // Generate token
      const token = generateToken(client._id);
  
      res.status(201).json({
        success: true,
        token,
        client
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  };

  module.exports = {registerClient,loginClient}