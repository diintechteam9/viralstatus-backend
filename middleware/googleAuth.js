const jwt = require('jsonwebtoken');
const axios = require('axios');
const Client = require('../models/client');

// ─── Public Key Cache ────────────────────────────────────────────────────────

const keyCache = {
  firebase: { keys: {}, expiry: 0 },
  google: { keys: {}, expiry: 0 },
};

const getFirebasePublicKeys = async () => {
  if (Date.now() < keyCache.firebase.expiry && Object.keys(keyCache.firebase.keys).length > 0) {
    return keyCache.firebase.keys;
  }
  try {
    const { data, headers } = await axios.get(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
      { timeout: 5000 }
    );
    const maxAge = parseInt((headers['cache-control'] || '').match(/max-age=(\d+)/)?.[1] || '3600');
    keyCache.firebase.keys = data;
    keyCache.firebase.expiry = Date.now() + maxAge * 1000;
    return data;
  } catch (error) {
    console.error('[GoogleAuth] Firebase key fetch failed:', error.message);
    throw new Error('Failed to fetch Firebase public keys. Please check your internet connection.');
  }
};

const getGooglePublicKeys = async () => {
  if (Date.now() < keyCache.google.expiry && Object.keys(keyCache.google.keys).length > 0) {
    return keyCache.google.keys;
  }
  try {
    const { data, headers } = await axios.get(
      'https://www.googleapis.com/oauth2/v1/certs',
      { timeout: 5000 }
    );
    const maxAge = parseInt((headers['cache-control'] || '').match(/max-age=(\d+)/)?.[1] || '3600');
    keyCache.google.keys = data;
    keyCache.google.expiry = Date.now() + maxAge * 1000;
    return data;
  } catch (error) {
    console.error('[GoogleAuth] Google key fetch failed:', error.message);
    throw new Error('Failed to fetch Google public keys. Please check your internet connection.');
  }
};

// ─── Token Verifiers ─────────────────────────────────────────────────────────

const verifyFirebaseToken = async (token) => {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) throw new Error('Invalid token format');

  const keys = await getFirebasePublicKeys();
  const publicKey = keys[decoded.header.kid];

  if (!publicKey) {
    const err = new Error('Token expired or invalid — Firebase public key not found');
    err.code = 'TOKEN_EXPIRED';
    throw err;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || 'yovoai';
  try {
    return jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') err.code = 'TOKEN_EXPIRED';
    throw err;
  }
};

const verifyGoogleOAuthToken = async (token) => {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) throw new Error('Invalid token format');

  const keys = await getGooglePublicKeys();
  const publicKey = keys[decoded.header.kid];

  if (!publicKey) {
    const err = new Error('Token expired or invalid — Google public key not found');
    err.code = 'TOKEN_EXPIRED';
    throw err;
  }

  try {
    // No audience check — accept any Google OAuth token from any client
    return jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      issuer: 'https://accounts.google.com',
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') err.code = 'TOKEN_EXPIRED';
    throw err;
  }
};

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Accepts both:
 * 1. Firebase ID token  (iss: securetoken.google.com/yovoai)  — from Flutter FirebaseAuth.getIdToken()
 * 2. Google OAuth token (iss: accounts.google.com)            — from Flutter GoogleSignIn idToken
 *
 * Token can be sent as:
 * - Authorization: Bearer <token>   ← preferred
 * - Body: { googleToken: "<token>" } ← fallback
 */
const verifyGoogleToken = async (req, res, next) => {
  try {
    let token;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else {
      token = req.body?.googleToken;
    }

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token required. Send as: Authorization: Bearer <token>',
      });
    }

    const decoded = jwt.decode(token);

    // Google Access Token (starts with ya29.) — verify via userinfo endpoint
    const isAccessToken = token.startsWith('ya29.');

    let payload;

    if (isAccessToken) {
      try {
        const { data } = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 5000
        });
        if (!data.email) throw new Error('Invalid access token: no email found');
        req.googleUser = {
          googleId: data.sub,
          email: data.email,
          name: data.name,
          picture: data.picture,
          emailVerified: data.email_verified,
        };
      } catch (error) {
        console.error('[GoogleAuth] Access token verification failed:', error.message);
        return res.status(401).json({
          success: false,
          message: 'Failed to verify access token. Please check your internet connection.',
          error: error.message,
        });
      }
    } else if (!decoded?.iss) {
      return res.status(401).json({ success: false, message: 'Invalid token format' });
    } else if (decoded.iss.startsWith('https://securetoken.google.com/')) {
      try {
        payload = await verifyFirebaseToken(token);
        req.googleUser = {
          googleId: payload.user_id || payload.sub,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
          emailVerified: payload.email_verified,
        };
      } catch (error) {
        console.error('[GoogleAuth] Firebase token verification failed:', error.message);
        return res.status(401).json({
          success: false,
          message: error.message || 'Failed to verify Firebase token. Please check your internet connection.',
          error: error.message,
        });
      }
    } else {
      try {
        payload = await verifyGoogleOAuthToken(token);
        req.googleUser = {
          googleId: payload.sub,
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
          emailVerified: payload.email_verified,
        };
      } catch (error) {
        console.error('[GoogleAuth] OAuth token verification failed:', error.message);
        return res.status(401).json({
          success: false,
          message: error.message || 'Failed to verify OAuth token. Please check your internet connection.',
          error: error.message,
        });
      }
    }

    next();
  } catch (error) {
    console.error('[GoogleAuth] Middleware error:', error.message);
    const isExpired = error.code === 'TOKEN_EXPIRED' || error.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      message: isExpired ? 'Token expired. Please sign in again.' : (error.message || 'Invalid token'),
      error: error.message,
    });
  }
};

// ─── JWT Middleware ───────────────────────────────────────────────────────────

const verifyJWTToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    const client = await Client.findById(decoded.id).select('-password');
    if (!client) return res.status(401).json({ success: false, message: 'User not found' });
    req.user = client;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
      const client = await Client.findById(decoded.id).select('-password');
      if (client) req.user = client;
    }
  } catch (_) {}
  next();
};

module.exports = { verifyGoogleToken, verifyJWTToken, optionalAuth };
