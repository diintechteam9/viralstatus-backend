const jwt = require('jsonwebtoken');
const Admin = require('../models/admin');
const Client = require('../models/client');
const User = require('../models/user');

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check user type and get user
    let user;
    if (decoded.userType === 'admin') {
      user = await Admin.findById(decoded.id).select('-password');
      if (!user) {
        return res.status(401).json({ message: 'Admin not found' });
      }
    } else if (decoded.userType === 'client') {
      user = await Client.findById(decoded.id).select('-password');
      if (!user) {
        return res.status(401).json({ message: 'Client not found' });
      }
    } else if (decoded.userType === 'user') {
      user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return res.status(401).json({ message: 'User not found' });
      }
    } else {
      return res.status(401).json({ message: 'Invalid user type' });
    }

    // Add user to request object
    req.user = {
      id: user._id,
      email: user.email,
      googleId: decoded.googleId, // Ensure googleId is set from JWT
      userType: decoded.userType,
      adminAccess: decoded.adminAccess
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    res.status(500).json({ message: 'Server error' });
  }
};

// Verify user token
const verifyToken = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log(decoded)
    // Try to find user by id
    let user = await User.findById(decoded.id).select('-password');
    if (user) {
      req.user = {
        id: user._id,
        email: user.email,
        googleId: user.googleId,
        adminAccess: user.adminAccess
      };
      console.log('req.user set in middleware:', req.user.googleId);
      return next();
    }
    // If not a user, try to find client by id
    let client = await Client.findById(decoded.id);
    if (client) {
      req.client = {
        id: client._id,
        googleId: client.googleId,
        email: client.email
      };
      console.log('req.client set in middleware:', req.client.id);
      return next();
    }
    // If neither user nor client found
    return res.status(401).json({ success: false, message: 'Invalid token: user/client not found' });
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

module.exports = { authMiddleware, verifyToken }; 