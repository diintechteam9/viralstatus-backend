const jwt = require('jsonwebtoken');
const MobileUser = require('../models/MobileUser');
const Client = require('../models/client');

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'No token provided' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // MobileUser token (role: 'mobileuser')
    if (decoded.role === 'mobileuser') {
      req.user = decoded;
      return next();
    }

    // Client token (role: 'client') — lookup MobileUser by email for profile ops
    if (decoded.role === 'client') {
      const client = await Client.findById(decoded.id).select('email clientId');
      if (!client) return res.status(401).json({ success: false, message: 'Client not found' });
      // Find linked MobileUser by email
      const mobileUser = await MobileUser.findOne({ email: client.email });
      if (mobileUser) {
        req.user = { id: mobileUser._id, email: mobileUser.email, role: 'mobileuser', clientId: decoded.clientId };
      } else {
        // No MobileUser linked — set client as user context
        req.user = { id: client._id, email: client.email, role: 'client', clientId: client.clientId };
      }
      return next();
    }

    // Legacy tokens without role — accept as-is
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

module.exports = { protect };
