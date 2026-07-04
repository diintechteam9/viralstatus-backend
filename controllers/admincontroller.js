const Admin = require("../models/admin");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Client = require("../models/client");
const { putobject, getobject } = require("../utils/r2");

// Generate JWT Token for admin
const generateAdminToken = (admin) => {
  return jwt.sign({
    id: admin._id,
    email: admin.email,
    role: admin.role || 'admin',
  }, process.env.JWT_SECRET, { expiresIn: '7d' });
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

    const admin = await Admin.create({ name, email, password: hashpassword, role: 'admin' });

    const token = generateAdminToken(admin);

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
        role: admin.role || 'admin',
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
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

const FILTER_VALUES = ['all', 'new', 'prime', 'demo', 'in-house', 'testing', 'rejected'];

const normalizeFilter = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const v = String(value).trim().toLowerCase();
  const map = {
    all: 'all', new: 'new', prime: 'prime', demo: 'demo',
    'in-house': 'in-house', testing: 'testing', rejected: 'rejected',
  };
  if (map[v]) return map[v];
  return FILTER_VALUES.includes(v) ? v : undefined;
};

const enrichClient = async (doc) => {
  const client = doc.toObject ? doc.toObject() : { ...doc };
  client.logoUrl = null;
  if (client.businessLogoKey) {
    try {
      client.logoUrl = await getobject(client.businessLogoKey);
    } catch (err) {
      console.error(`[client] logo presign failed for ${client._id}:`, err.message);
    }
  }
  if (!client.logoUrl && client.businessLogoUrl) {
    client.logoUrl = client.businessLogoUrl;
  }
  if (!client.name && client.contactPerson) {
    client.name = client.contactPerson;
  }
  if (client.filter) {
    client.filter = normalizeFilter(client.filter) || client.filter;
  }
  return client;
};

const attachLogoUrls = async (clients) => {
  return Promise.all(clients.map((doc) => enrichClient(doc)));
};

const getClients = async (req, res) => {
    try {
      const clients = await Client.find().select('-password').sort({ createdAt: -1 });
      const data = await attachLogoUrls(clients);

      res.status(200).json({
        success: true,
        count: data.length,
        data,
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
        finalBusinessLogoUrl = await getobject(businessLogoKey);
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

  // Update client (editable fields + optional password)
  const updateClient = async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, message: "Client ID is required" });
      }

      const existing = await Client.findById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }

      const allowedFields = [
        "name", "email", "businessName", "websiteUrl", "city", "pincode",
        "gstNo", "panNo", "businessLogoKey", "businessLogoUrl", "filter",
      ];

      const updatePayload = {};
      for (const key of allowedFields) {
        if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
        let val = req.body[key];
        if (val === undefined || val === null) continue;
        if (typeof val === "string") val = val.trim();
        if (key === "filter") {
          const normalized = normalizeFilter(val);
          if (normalized) updatePayload.filter = normalized;
          continue;
        }
        if (key === "email" && val) {
          updatePayload.email = String(val).toLowerCase();
          continue;
        }
        updatePayload[key] = val;
      }

      if (req.body.password && String(req.body.password).trim()) {
        const pwd = String(req.body.password).trim();
        if (pwd.length < 6) {
          return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
        }
        updatePayload.password = await bcrypt.hash(pwd, 10);
      }

      if (Object.keys(updatePayload).length === 0) {
        return res.status(400).json({ success: false, message: "No valid fields to update" });
      }

      updatePayload.updatedAt = new Date();

      const updated = await Client.findByIdAndUpdate(
        id,
        { $set: updatePayload },
        { new: true, runValidators: true, select: "-password" }
      );

      if (!updated) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }

      const data = await enrichClient(updated);
      res.status(200).json({ success: true, message: "Client updated successfully", data });
    } catch (error) {
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern || {})[0];
        const fieldName = field === "gstNo" ? "GST Number" : field === "panNo" ? "PAN Number" : field === "email" ? "Email" : field;
        return res.status(400).json({ success: false, message: `Duplicate value for ${fieldName}` });
      }
      if (error.name === "ValidationError") {
        const msg = Object.values(error.errors || {}).map((e) => e.message).join(", ") || error.message;
        return res.status(400).json({ success: false, message: msg });
      }
      console.error("Error updating client:", error);
      res.status(500).json({ success: false, message: error.message || "Failed to update client" });
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
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
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
        role: 'client',
        adminAccess: true
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

    const uploadUrl = await putobject(s3Key, mimeType);
    let fileUrl = null;
    try {
      fileUrl = await getobject(s3Key);
    } catch (err) {
      console.error('[uploadBusinessLogo] presign read URL failed:', err.message);
    }

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

    const presignedUrl = await getobject(businessLogoKey);

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

// ── GET /api/admin/users — list all mobile users (admin only) ─────────────────
const getAllMobileUsers = async (req, res) => {
  try {
    const MobileUser = require('../models/MobileUser');
    const {
      search = '',
      clientId = '',
      page = 1,
      limit = 50,
    } = req.query;

    const filter = {};
    if (clientId) filter.clientId = clientId;
    if (search.trim()) {
      const q = search.trim();
      filter.$or = [
        { name:   { $regex: q, $options: 'i' } },
        { email:  { $regex: q, $options: 'i' } },
        { mobile: { $regex: q, $options: 'i' } },
      ];
    }

    const skip  = (Math.max(1, Number(page)) - 1) * Math.min(100, Number(limit));
    const take  = Math.min(100, Number(limit));
    const total = await MobileUser.countDocuments(filter);

    const users = await MobileUser
      .find(filter)
      .select('name email mobile city clientId clientCode profileImageUrl registrationStep emailVerified createdAt lastLoginAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(take)
      .lean();

    res.json({ success: true, users, total, page: Number(page), limit: take });
  } catch (err) {
    console.error('[Admin] getAllMobileUsers error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/admin/switch-user/:userId — impersonate a mobile user ──────────
// Creates a short-lived token that logs admin into the user portal as that user.
// Token carries switchedByAdmin flag so the frontend can show a banner.
const switchToUser = async (req, res) => {
  try {
    const MobileUser = require('../models/MobileUser');
    const { userId } = req.params;

    const user = await MobileUser.findById(userId).lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const clientDoc = user.clientId
      ? await Client.findById(user.clientId).lean()
      : null;

    // Issue a short-lived (2h) impersonation token
    const impersonationToken = jwt.sign(
      {
        id:              user._id,
        email:           user.email,
        role:            'mobileuser',
        clientId:        clientDoc?.clientId     || '',
        clientObjectId:  String(user.clientId)   || '',
        // Audit fields — carried in token, never stored to DB
        switchedByAdmin: true,
        adminId:         String(req.user.id),
        adminEmail:      req.user.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    const userData = {
      role:     'mobileuser',
      name:     user.name  || '',
      email:    user.email || '',
      clientId: clientDoc?.clientId || '',
      userId:   String(user._id),
      googleId: user.googleId || '',
      // Flags for frontend banner
      switchedByAdmin: true,
      adminEmail:      req.user.email,
    };

    res.json({
      success: true,
      token:    impersonationToken,
      userData,
      message: `Switched to ${user.name || user.email}`,
    });
  } catch (err) {
    console.error('[Admin] switchToUser error:', err.message);
    res.status(500).json({ success: false, message: err.message });
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
  getBusinessLogoUrl,
  getAllMobileUsers,
  switchToUser,
};
