const mongoose = require('mongoose');
const MobileUser = require('../models/MobileUser');
const User = require('../models/user');

/**
 * Batch-resolve display info for participant googleIds.
 * @param {string[]} googleIds
 * @returns {Promise<Record<string, { name, email, mobile, city, googleId }>>}
 */
async function resolveUserProfiles(googleIds) {
  const ids = [...new Set((googleIds || []).filter(Boolean))];
  const map = {};

  if (ids.length === 0) return map;

  const mobileUsers = await MobileUser.find({
    $or: [
      { googleId: { $in: ids } },
      ...(ids.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => ({ _id: id }))),
    ],
  }).select('name email mobile mobileNumber city googleId');

  for (const u of mobileUsers) {
    const key = u.googleId || u._id?.toString();
    if (key) {
      map[key] = {
        name: u.name || 'Unknown',
        email: u.email || 'N/A',
        mobile: u.mobileNumber || u.mobile || 'N/A',
        city: u.city || 'N/A',
        googleId: key,
      };
    }
  }

  const missing = ids.filter((id) => !map[id]);
  if (missing.length) {
    const webUsers = await User.find({ googleId: { $in: missing } }).select('name email googleId');
    for (const u of webUsers) {
      map[u.googleId] = {
        name: u.name || 'Unknown',
        email: u.email || 'N/A',
        mobile: 'N/A',
        city: 'N/A',
        googleId: u.googleId,
      };
    }
  }

  for (const id of ids) {
    if (!map[id]) {
      map[id] = {
        name: `User ${id.slice(0, 8)}…`,
        email: 'N/A',
        mobile: 'N/A',
        city: 'N/A',
        googleId: id,
      };
    }
  }

  return map;
}

async function resolveOneUserProfile(googleId) {
  const map = await resolveUserProfiles([googleId]);
  return map[googleId] || { name: 'Unknown', email: 'N/A', mobile: 'N/A', city: 'N/A', googleId };
}

module.exports = { resolveUserProfiles, resolveOneUserProfile };
