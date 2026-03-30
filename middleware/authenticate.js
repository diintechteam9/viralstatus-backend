const jwt = require('jsonwebtoken');
const Admin = require('../models/admin');
const Client = require('../models/client');
const MobileUser = require('../models/MobileUser');

// ─── authenticate ─────────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Support both new (role) and old (userType) token formats
    const role = decoded.role || decoded.userType;

    // Admin / Super Admin
    if (role === 'admin' || role === 'super_admin') {
      const admin = await Admin.findById(decoded.id).select('-password');
      if (!admin) return res.status(401).json({ success: false, message: 'Admin not found' });
      if (admin.isActive === false) return res.status(403).json({ success: false, message: 'Admin account is inactive' });
      req.user = { id: admin._id, email: admin.email, role: admin.role || 'admin', name: admin.name };
      return next();
    }

    // Client — support old type:'client' format too
    if (role === 'client' || decoded.type === 'client') {
      const client = await Client.findById(decoded.id).select('-password');
      if (!client) return res.status(401).json({ success: false, message: 'Client not found' });
      if (!client.isActive) return res.status(403).json({ success: false, message: 'Client account is inactive' });
      req.user = { id: client._id, email: client.email, role: 'client', clientId: client.clientId, name: client.businessName };
      return next();
    }

    // Mobile User
    if (role === 'mobileuser') {
      const user = await MobileUser.findById(decoded.id).select('-password');
      if (!user) return res.status(401).json({ success: false, message: 'User not found' });
      req.user = { id: user._id, email: user.email, role: 'mobileuser', clientId: decoded.clientId, name: user.name };
      return next();
    }

    return res.status(401).json({ success: false, message: 'Invalid token role' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired. Please login again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// ─── authorize ────────────────────────────────────────────────────────────────
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Access denied. Required roles: ${roles.join(', ')}`,
    });
  }
  next();
};

module.exports = { authenticate, authorize };
