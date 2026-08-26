const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Client = require("../models/client");

// Generate JWT Token for client
const generateToken = (client) => {
  return jwt.sign(
    { id: client._id, clientId: client.clientId, role: "client" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
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
            businessName: '',
            gstNo: "GOOGLE" + Date.now(),
            panNo: "GOOGLE" + Date.now(),
            city: "",
            pincode: "",
          });
          
          console.log('New Google-authenticated client created:', client._id);
        }
        
        // Generate JWT token
        const authToken = generateToken(client);
        
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
      const jwtToken = generateToken(client);
  
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
      const crypto = require("crypto");
      const {
        name,
        email,
        password,
        businessName,
        gstNo,
        panNo,
        city,
        pincode,
        websiteUrl,
        businessLogoKey,
        businessLogoUrl
      } = req.body;
  
      // Check if client email already exists
      const existingClient = await Client.findOne({ email });
      if (existingClient) {
        return res.status(400).json({
          success: false,
          message: "Email already registered"
        });
      }
  
      // Check if client already exists with the same GST/PAN
      const existingBusinessClient = await Client.findOne({
        $or: [
          { gstNo },
          { panNo }
        ]
      });
  
      if (existingBusinessClient) {
        return res.status(400).json({
          success: false,
          message: "Client already exists with the same GST or PAN number"
        });
      }
  
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
  
      // Use the provided businessLogoUrl or construct from key if needed
      let finalBusinessLogoUrl = businessLogoUrl;
      if (businessLogoKey && !businessLogoUrl) {
        const { getobject } = require('../utils/r2');
        finalBusinessLogoUrl = await getobject(businessLogoKey);
      }

      // Generate clientKey
      const clientKey = crypto.randomBytes(16).toString("hex");

      // Create new client
      const client = await Client.create({
        name,
        email,
        password: hashedPassword,
        businessName,
        gstNo,
        panNo,
        city,
        pincode,
        websiteUrl,
        businessLogoKey,
        businessLogoUrl: finalBusinessLogoUrl,
        clientKey
      });
  
      // Generate token
      const token = generateToken(client._id);
  
      res.status(201).json({
        success: true,
        token,
        client,
        clientKey
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  };
  // Get current client key
  const getClientKey = async (req, res) => {
    try {
      const clientId = req.user?.id || req.client?.id;
      if (!clientId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const client = await Client.findById(clientId);
      if (!client) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }

      res.status(200).json({
        success: true,
        clientKey: client.clientKey || null
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  // Generate a new client key
  const generateClientKey = async (req, res) => {
    try {
      const clientId = req.user?.id || req.client?.id;
      if (!clientId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const crypto = require("crypto");
      const clientKey = crypto.randomBytes(16).toString("hex");

      const client = await Client.findByIdAndUpdate(
        clientId,
        { clientKey },
        { new: true }
      );

      if (!client) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }

      res.status(200).json({
        success: true,
        message: "Key generated successfully",
        clientKey: client.clientKey
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  // Delete the client key
  const deleteClientKey = async (req, res) => {
    try {
      const clientId = req.user?.id || req.client?.id;
      if (!clientId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      // Instead of setting to null, we can set to an empty string, or unset it.
      // Setting to null works, but $unset is cleaner.
      const client = await Client.findByIdAndUpdate(
        clientId,
        { $unset: { clientKey: "" } },
        { new: true }
      );

      if (!client) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }

      res.status(200).json({
        success: true,
        message: "Key deleted successfully",
        clientKey: null
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  // Login with Client Key
  const loginClientWithKey = async (req, res) => {
    try {
      const { clientKey } = req.body;

      if (!clientKey) {
        return res.status(400).json({
          success: false,
          message: "Client key is required"
        });
      }

      // Find client by clientKey
      const client = await Client.findOne({ clientKey });
      
      if (!client) {
        console.log('Login attempt failed with invalid clientKey');
        return res.status(401).json({
          success: false,
          message: "Invalid client key"
        });
      }

      // Generate token
      const jwtToken = generateToken(client);

      console.log('Login successful with clientKey for:', client.email);

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
          city: client.city,
          pincode: client.pincode,
          websiteUrl: client.websiteUrl
        }
      });
    } catch (error) {
      console.error('Login with key error:', error);
      res.status(500).json({
        success: false,
        message: error.message || "An error occurred during login"
      });
    }
  };

  module.exports = { registerClient, loginClient, getClientKey, generateClientKey, deleteClientKey, loginClientWithKey }