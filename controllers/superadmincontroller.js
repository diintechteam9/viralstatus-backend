const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Superadmin = require("../models/superadmin");
const Admin = require("../models/admin");
const Client = require("../models/client")

// Generate JWT Token for admin
const generateAdminToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

const registerSuperadmin = async (req, res) => {
  try {
    const { name, email, password, superadmincode } = req.body;

    if (superadmincode != process.env.SUPERADMIN_REGISTRATION_CODE) {
      console.log(superadmincode, process.env.SUPERADMIN_REGISTRATION_CODE);
      return res.status(401).json({ message: "Invalid superadmin code" });
    }

    const existingadmin = await Superadmin.findOne({ email });
    if (existingadmin) {
      return res.status(400).json({ message: "Superadmin already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashpassword = await bcrypt.hash(password, salt);

    const superadmin = await Superadmin.create({ name, email, password: hashpassword });

    const token = generateAdminToken(superadmin._id);

    res.status(201).json({
      success: true,
      token,
      superadmin,
    });

    console.log("Superadmin registered successfully");
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Superadmin registration failed");
  }
};

const loginSuperadmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const superadmin = await Superadmin.findOne({ email });

    const ispasswordvalid = await bcrypt.compare(password, superadmin.password);

    if (!ispasswordvalid) {
      return res.status(401).json({ meassage: "invalid credentials" });
    }

    if (!superadmin) {
      return res.status(401).json({ message: "superadmin not found" });
    }

    const token = generateAdminToken(superadmin._id);

    res.status(200).json({
      success: true,
      token,
      superadmin,
    });

    console.log("superamdin login successfully");
  } catch (error) {
    console.log("login failed");
  }
};

const getadmins = async(req,res)=>{
  try {
      const admins = await Admin.find().select('-password');
      
      res.status(200).json({
        success: true,
        count: admins.length,
        data: admins
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
}

const deleteadmin = async(req, res) => {
  try {
      const id = req.params.id;
      if (!id) {
          return res.status(400).json({
              success: false,
              message: "Admin ID is required"
          });
      }

      const admin = await Admin.findByIdAndDelete(id);
      if (!admin) {
          return res.status(404).json({
              success: false,
              message: "Admin not found"
          });
      }

      res.status(200).json({
          success: true,
          message: "Admin deleted successfully"
      });
  } catch (error) {
      console.error('Error deleting admin:', error);
      res.status(500).json({
          success: false,
          message: "Failed to delete admin"
      });
  }
}

const registeradmin = async (req, res) => {
try {
  const { name, email, password } = req.body;

  // Check if admin already exists
  const existingAdmin = await Admin.findOne({ email });
  if (existingAdmin) {
    return res.status(400).json({
      success: false,
      message: "Admin with this email already exists"
    });
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create new admin
  const admin = await Admin.create({
    name,
    email,
    password: hashedPassword
  });

  // Remove password from response
  const adminResponse = admin.toObject();
  delete adminResponse.password;

  res.status(201).json({
    success: true,
    message: "Admin created successfully",
    data: adminResponse
  });
} catch (error) {
  console.error('Error creating admin:', error);
  res.status(500).json({
    success: false,
    message: "Failed to create admin"
  });
}
};

const getclients = async(req,res)=>{
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
}

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
      aadharNo
    } = req.body;

    // Check if client already exists
    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(400).json({
        success: false,
        message: "Client with this email already exists"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

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
      aadharNo
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
    res.status(500).json({
      success: false,
      message: "Failed to create client"
    });
  }
};

module.exports = {
  registerSuperadmin,
  loginSuperadmin,
  registeradmin,
  getadmins,
  deleteadmin,
  registerclient,
  getclients,
  deleteclient
};
