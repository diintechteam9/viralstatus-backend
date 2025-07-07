const jwt = require('jsonwebtoken');
const Client = require('../models/client');
const User = require('../models/user');

// Protect routes - verify token
exports.protect = async (req, res, next) => {
  let token;

  // Check for token in headers
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // Check if token exists
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Try to find user
    const user = await User.findById(decoded.id);
    if (user) {
      req.user = { id: user._id, email: user.email };
      return next();
    }

    // Try to find client
    const client = await Client.findById(decoded.id);
    if (client) {
      req.client = { id: client._id, email: client.email };
      req.clientDetails = {
        name: client.name,
        businessName: client.businessName,
        city: client.city,
        pincode: client.pincode
      };
      return next();
    }

    // If neither found, unauthorized
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
}; 