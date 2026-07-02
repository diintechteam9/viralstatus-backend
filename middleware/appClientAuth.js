const jwt = require('jsonwebtoken');

/**
 * Accepts Bearer appClientToken (role: appclient) or admin/super_admin fallback.
 */
const appClientAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const role = decoded.role || decoded.userType;

    if (role === 'appclient' || role === 'app') {
      req.auth = {
        type: 'appclient',
        appId: String(decoded.appId || decoded.id),
        userId: decoded.id,
        email: decoded.email,
      };
      return next();
    }

    if (role === 'admin' || role === 'super_admin') {
      req.auth = { type: 'admin', appId: null, userId: decoded.id, role };
      return next();
    }

    return res.status(403).json({ success: false, message: 'Access denied' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired. Please login again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

module.exports = { appClientAuth };
