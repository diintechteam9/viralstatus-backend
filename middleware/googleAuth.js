const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const Client = require('../models/client');

// Initialize Google OAuth2 client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_ANDROID_CLIENT_ID);

/**
 * Middleware to verify Google ID token
 * This middleware validates the Google ID token sent from the Flutter app
 */
const verifyGoogleToken = async (req, res, next) => {
  // Log incoming request body and env for debugging
  console.error('verifyGoogleToken: incoming body:', req.body);
  console.error('verifyGoogleToken: GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
  try {
    const { googleToken } = req.body;

    if (!googleToken) {
      console.error('verifyGoogleToken: googleToken missing in request body');
      return res.status(400).json({
        success: false,
        message: 'Google token is required'
      });
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: googleToken,
      audience: [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID].filter(Boolean),
    });

    const payload = ticket.getPayload();
    
    // Add Google user info to request
    req.googleUser = {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      emailVerified: payload.email_verified,
      googleToken: googleToken
    };

    
    next();
  } catch (error) {
    console.error('verifyGoogleToken error:', error && error.stack ? error.stack : error);
    return res.status(401).json({
      success: false,
      message: 'Invalid Google token',
      error: error && error.message ? error.message : error
    });
  }
};

/**
 * Middleware to verify JWT token and attach user to request
 */
const verifyJWTToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find user by ID
    const client = await Client.findById(decoded.id).select('-password');
    
    if (!client) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    req.user = client;
    next();
  } catch (error) {
    console.error('JWT verification error:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

/**
 * Optional middleware - verifies token if present, but doesn't require it
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const client = await Client.findById(decoded.id).select('-password');
      
      if (client) {
        req.user = client;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
};

module.exports = {
  verifyGoogleToken,
  verifyJWTToken,
  optionalAuth
}; 