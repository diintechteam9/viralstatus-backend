const Admin = require("../models/admin");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Client = require("../models/client");
const { s3, BUCKET_NAME } = require("../config/s3");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Generate JWT Token for admin
const generateAdminToken = (id) => {
  return jwt.sign({ 
    id,
    userType: 'admin'  // Add userType to the token
  }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

const registerAdmin = async (req, res) => {
  try {
    const { name, email, password, admincode } = req.body;

    if (admincode != process.env.ADMIN_REGISTRATION_CODE) {
      console.log(admincode, process.env.ADMIN_REGISTRATION_CODE);
      return res.status(401).json({ message: "Invalid admin code" });
    }

    const existingadmin = await Admin.findOne({ email });
    if (existingadmin) {
      return res.status(400).json({ message: "Admin already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashpassword = await bcrypt.hash(password, salt);

    const admin = await Admin.create({ name, email, password: hashpassword });

    const token = generateAdminToken(admin._id);

    res.status(201).json({
      success: true,
      token,
      admin,
    });

    console.log("Admin registered successfully");
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Admin registration failed");
  }
};

const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(401).json({ message: "Admin not found" });
    }

    const ispasswordvalid = await bcrypt.compare(password, admin.password);
    if (!ispasswordvalid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { 
        id: admin._id,
        email: admin.email,
        userType: 'admin'
      }, 
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      success: true,
      token,
      admin,
    });

    console.log("Admin login successful");
  } catch (error) {
    console.error("Login failed:", error);
    res.status(500).json({ message: error.message });
  }
};

const getClients = async (req, res) => {
    try {
      const clients = await Client.find().select('-password');
      
      res.status(200).json({
        success: true,
        count: clients.length,
        data: clients
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  };
  
  // Get client profile by ID
  const getClientById = async (req, res) => {
    try {
      const client = await Client.findById(req.params.id).select('-password');
      
      if (!client) {
        return res.status(404).json({
          success: false,
          message: "Client not found"
        });
      }
      
      res.status(200).json({
        success: true,
        data: client
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  };

  const registerclient = async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        businessName,
        websiteUrl,
        city,
        pincode,
        gstNo,
        panNo,
        businessLogoKey,
        businessLogoUrl
      } = req.body;
  
      // Check if client already exists with email
      const existingClient = await Client.findOne({ email });
      if (existingClient) {
        return res.status(400).json({
          success: false,
          message: "Client with this email already exists"
        });
      }

      // Check for duplicate GST and PAN numbers
      const duplicateFields = [];
      const existingBusinessClient = await Client.findOne({
        $or: [
          { gstNo: gstNo },
          { panNo: panNo }
        ]
      });

      if (existingBusinessClient) {
        if (existingBusinessClient.gstNo === gstNo) {
          duplicateFields.push("GST Number");
        }
        if (existingBusinessClient.panNo === panNo) {
          duplicateFields.push("PAN Number");
        }
        
        return res.status(400).json({
          success: false,
          message: `Client already exists with the same ${duplicateFields.join(", ")}`
        });
      }
  
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
  
      // Use the provided businessLogoUrl or construct from key if needed
      let finalBusinessLogoUrl = businessLogoUrl;
      if (businessLogoKey && !businessLogoUrl) {
        finalBusinessLogoUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${businessLogoKey}`;
      }

      // Create new client
      const client = await Client.create({
        name,
        email,
        password: hashedPassword,
        businessName,
        websiteUrl,
        city,
        pincode,
        gstNo,
        panNo,
        businessLogoKey,
        businessLogoUrl: finalBusinessLogoUrl
      });
  
      // Remove password from response
      const clientResponse = client.toObject();
      delete clientResponse.password;
  
      res.status(201).json({
        success: true,
        message: "Client created successfully",
        data: clientResponse
      });
    } catch (error) {
      console.error('Error creating client:', error);
      
      // Handle MongoDB duplicate key errors
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        const fieldName = field === 'gstNo' ? 'GST Number' : 
                         field === 'panNo' ? 'PAN Number' : field;
        
        return res.status(400).json({
          success: false,
          message: `Client already exists with the same ${fieldName}`
        });
      }
      
      res.status(500).json({
        success: false,
        message: "Failed to create client"
      });
    }
  };

  const deleteclient = async(req, res) => {
    try {
        const id = req.params.id;
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Client ID is required"
            });
        }
  
        const client = await Client.findByIdAndDelete(id);
        if (!client) {
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }
  
        res.status(200).json({
            success: true,
            message: "Client deleted successfully"
        });
    } catch (error) {
        console.error('Error deleting client:', error);
        res.status(500).json({
            success: false,
            message: "Failed to delete client"
        });
    }
  }

  // Update client (e.g., set filter and editable fields)
  const updateClient = async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, message: "Client ID is required" });
      }

      const allowedFields = [
        "name",
        "email",
        "businessName",
        "websiteUrl",
        "city",
        "pincode",
        "gstNo",
        "panNo",
        "businessLogoKey",
        "businessLogoUrl",
        "filter",
      ];

      const updatePayload = {};
      for (const key of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(req.body, key)) {
          updatePayload[key] = req.body[key];
        }
      }

      const updated = await Client.findByIdAndUpdate(
        id,
        { $set: updatePayload },
        { new: true, runValidators: true, select: "-password" }
      );

      if (!updated) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }

      res.status(200).json({ success: true, message: "Client updated", data: updated });
    } catch (error) {
      // Handle duplicate key errors
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        const fieldName = field === "gstNo" ? "GST Number" : field === "panNo" ? "PAN Number" : field;
        return res.status(400).json({ success: false, message: `Duplicate value for ${fieldName}` });
      }
      console.error("Error updating client:", error);
      res.status(500).json({ success: false, message: "Failed to update client" });
    }
  };

// Get client token for admin access
const getClientToken = async (req, res) => {
  try {
    const { clientId } = req.params;
    const adminId = req.user.id;

    console.log('getClientToken called with:', {
      clientId,
      adminId,
      userType: req.user.userType
    });

    // Verify admin exists and is authenticated
    if (req.user.userType !== 'admin') {
      console.log('Invalid user type:', req.user.userType);
      return res.status(401).json({ message: 'Only admins can access client tokens' });
    }

    const admin = await Admin.findById(adminId);
    if (!admin) {
      console.log('Admin not found:', adminId);
      return res.status(401).json({ message: 'Admin not found' });
    }
    console.log('Admin verified:', admin.email);

    // Get client details
    const client = await Client.findById(clientId);
    if (!client) {
      console.log('Client not found:', clientId);
      return res.status(404).json({ message: 'Client not found' });
    }
    console.log('Client found:', client.email);

    // Generate token for client with admin access flag
    const token = jwt.sign(
      { 
        id: client._id,
        email: client.email,
        userType: 'client',
        adminAccess: true // Flag to indicate this is admin-accessed client session
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    console.log('Generated client token for:', client.email);
    res.json({ token });
  } catch (error) {
    console.error('Error in getClientToken:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Upload business logo for admin
const uploadBusinessLogo = async (req, res) => {
  try {
    const { fileName, fileSize, mimeType } = req.body;

    if (!fileName || !fileSize || !mimeType) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: fileName, fileSize, mimeType"
      });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid file type. Only image files are allowed."
      });
    }

    // Validate file size (max 5MB)
    if (fileSize > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: "File size too large. Maximum 5MB allowed."
      });
    }

    // Generate unique S3 key for business logo
    const timestamp = Date.now();
    const s3Key = `admin/business-logos/${timestamp}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

    // Create presigned URL for upload with proper configuration
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      ContentType: mimeType
    });

    const uploadUrl = await getSignedUrl(s3, command, { 
      expiresIn: 3600,
      unhoistableHeaders: new Set(['x-amz-acl'])
    });

    // Construct the final S3 URL
    const fileUrl = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

    console.log('Generated upload URL for:', s3Key);

    res.json({
      success: true,
      uploadUrl,
      s3Key,
      fileUrl,
      message: "Upload URL generated successfully"
    });

  } catch (error) {
    console.error("Error generating upload URL:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate upload URL",
      error: error.message
    });
  }
};

// Get presigned URL for business logo
const getBusinessLogoUrl = async (req, res) => {
  try {
    const { businessLogoKey } = req.body;

    if (!businessLogoKey) {
      return res.status(400).json({
        success: false,
        message: "Business logo key is required"
      });
    }

    // Create presigned URL for accessing the business logo
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: businessLogoKey
    });

    const presignedUrl = await getSignedUrl(s3, command, {
      expiresIn: 3600 // 1 hour
    });

    res.json({
      success: true,
      url: presignedUrl,
      message: "Presigned URL generated successfully",
      expiresIn: "1 hour"
    });

  } catch (error) {
    console.error("Error generating presigned URL:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate presigned URL"
    });
  }
};

module.exports = {
  registerAdmin,
  registerclient,
  loginAdmin,
  getClients,
  getClientById,
  deleteclient,
  updateClient,
  getClientToken,
  uploadBusinessLogo,
  getBusinessLogoUrl
};
