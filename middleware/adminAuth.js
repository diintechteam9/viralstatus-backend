const { authenticate, authorize } = require('./authenticate');

/** Admin + super_admin only */
const adminAuth = [authenticate, authorize('admin', 'super_admin')];

module.exports = adminAuth;
