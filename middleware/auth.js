const jwt = require('jsonwebtoken');
const Client = require('../models/client');

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

    // Set client in request
    req.client = { id: decoded.id };
    
    // Try to get email from token first
    let userEmail = decoded.email || decoded.clientEmail || decoded.userEmail || decoded.user?.email;
    
    // If no email in token, fetch client details from database
    if (!userEmail && decoded.id) {
      try {
        const client = await Client.findById(decoded.id).select('email name businessName city pincode');
        if (client) {
          userEmail = client.email;
          // Also set other client details for user profile
          req.clientDetails = {
            name: client.name,
            businessName: client.businessName,
            city: client.city,
            pincode: client.pincode
          };
        }
      } catch (dbError) {
        console.error('Error fetching client details:', dbError);
      }
    }
    
    // Also set user for user profile routes
    req.user = { 
      id: decoded.id,
      email: userEmail
    };
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
}; 