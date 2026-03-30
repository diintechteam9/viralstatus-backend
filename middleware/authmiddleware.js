const jwt = require('jsonwebtoken');
const Admin = require('../models/admin');
const Client = require('../models/client');
const User = require('../models/user');
const MobileUser = require('../models/MobileUser');

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

/**
 * Loose JWT guard for shared user/client routes (e.g. campaigns).
 * Supports: GoogleUser (User), password/Google Client, MobileUser, Admin.
 * Legacy tokens may only contain { id } — resolve by collection lookup order.
 */
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.userType === 'admin' || decoded.role === 'admin' || decoded.role === 'super_admin') {
      const admin = await Admin.findById(decoded.id).select('-password');
      if (!admin) {
        return res.status(401).json({ success: false, message: 'Invalid token: admin not found' });
      }
      req.user = {
        id: admin._id,
        email: admin.email,
        googleId: null,
        adminAccess: true,
        userType: admin.role || 'admin',
        role: admin.role || 'admin',
      };
      return next();
    }

    let user = await User.findById(decoded.id).select('-password');
    if (user) {
      req.user = {
        id: user._id,
        email: user.email,
        googleId: user.googleId,
        adminAccess: user.adminAccess,
        userType: decoded.userType || 'user',
      };
      return next();
    }

    const client = await Client.findById(decoded.id).select('-password');
    if (client) {
      req.client = {
        id: client._id,
        googleId: client.googleId,
        email: client.email,
        clientId: client.clientId,
      };
      req.user = {
        id: client._id,
        email: client.email,
        googleId: client.googleId,
        userType: 'client',
      };
      return next();
    }

    const mobile = await MobileUser.findById(decoded.id).select('-password');
    if (mobile) {
      const stableUserId =
        mobile.googleId || mobile.firebaseUid || `mobile:${mobile._id.toString()}`;
      req.user = {
        id: mobile._id,
        email: mobile.email,
        googleId: stableUserId,
        userType: 'mobileuser',
        role: 'mobileuser',
      };
      return next();
    }

    return res.status(401).json({ success: false, message: 'Invalid token: user/client not found' });
  } catch (error) {
    console.error('Token verification error:', error.name || error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired. Please sign in again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

module.exports = { authMiddleware, verifyToken }; 