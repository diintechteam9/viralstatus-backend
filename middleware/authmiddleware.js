const jwt = require('jsonwebtoken');
const Admin = require('../models/admin');
const Client = require('../models/client');

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
    } else {
      return res.status(401).json({ message: 'Invalid user type' });
    }

    // Add user to request object
    req.user = {
      id: user._id,
      email: user.email,
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

module.exports = { authMiddleware }; 