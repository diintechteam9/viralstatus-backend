const MobileUser = require('../models/MobileUser');

/**
 * Filter participants by location criteria
 * Supports: pincode, city, state, area (geographic boundary)
 */
async function filterParticipantsByLocation(userIds, filters = {}) {
  if (!userIds || userIds.length === 0) return [];

  const { pincode, city, state, area, latitude, longitude, radiusKm } = filters;

  // Build MongoDB query
  const query = { googleId: { $in: userIds } };

  if (pincode) {
    query.$or = [
      { pincode: pincode },
      { 'locationAddress.pincode': pincode }
    ];
  }

  if (city) {
    query.$or = query.$or || [];
    query.$or.push(
      { city: { $regex: city, $options: 'i' } },
      { 'locationAddress.city': { $regex: city, $options: 'i' } }
    );
  }

  if (state) {
    query.$or = query.$or || [];
    query.$or.push(
      { 'locationAddress.state': { $regex: state, $options: 'i' } }
    );
  }

  // Geo-spatial query for radius-based filtering
  if (latitude && longitude && radiusKm) {
    const radiusMeters = radiusKm * 1000;
    query['location.latitude'] = {
      $gte: latitude - (radiusKm / 111),
      $lte: latitude + (radiusKm / 111)
    };
    query['location.longitude'] = {
      $gte: longitude - (radiusKm / (111 * Math.cos(latitude * Math.PI / 180))),
      $lte: longitude + (radiusKm / (111 * Math.cos(latitude * Math.PI / 180)))
    };
  }

  const users = await MobileUser.find(query).select(
    'googleId name email city pincode location locationAddress'
  ).lean();

  return users;
}

/**
 * Get location statistics for participants
 */
async function getLocationStats(userIds) {
  if (!userIds || userIds.length === 0) return {};

  const users = await MobileUser.find({ googleId: { $in: userIds } }).lean();

  const stats = {
    totalParticipants: users.length,
    byCity: {},
    byPincode: {},
    byState: {},
    withLocation: 0,
    withoutLocation: 0
  };

  for (const user of users) {
    const city = user.city || user.locationAddress?.city || 'Unknown';
    const pincode = user.pincode || user.locationAddress?.pincode || 'Unknown';
    const state = user.locationAddress?.state || 'Unknown';

    stats.byCity[city] = (stats.byCity[city] || 0) + 1;
    stats.byPincode[pincode] = (stats.byPincode[pincode] || 0) + 1;
    stats.byState[state] = (stats.byState[state] || 0) + 1;

    if (user.location?.latitude && user.location?.longitude) {
      stats.withLocation++;
    } else {
      stats.withoutLocation++;
    }
  }

  return stats;
}

/**
 * Get participants grouped by location
 */
async function getParticipantsByLocation(userIds, groupBy = 'city') {
  if (!userIds || userIds.length === 0) return {};

  const users = await MobileUser.find({ googleId: { $in: userIds } }).select(
    'googleId name email city pincode location locationAddress'
  ).lean();

  const grouped = {};

  for (const user of users) {
    let key;
    if (groupBy === 'city') {
      key = user.city || user.locationAddress?.city || 'Unknown';
    } else if (groupBy === 'pincode') {
      key = user.pincode || user.locationAddress?.pincode || 'Unknown';
    } else if (groupBy === 'state') {
      key = user.locationAddress?.state || 'Unknown';
    }

    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push({
      googleId: user.googleId,
      name: user.name,
      email: user.email,
      city: user.city || user.locationAddress?.city,
      pincode: user.pincode || user.locationAddress?.pincode,
      state: user.locationAddress?.state,
      location: user.location
    });
  }

  return grouped;
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Filter participants by geographic radius
 */
async function filterByRadius(userIds, centerLat, centerLon, radiusKm) {
  if (!userIds || userIds.length === 0) return [];

  const users = await MobileUser.find({
    googleId: { $in: userIds },
    'location.latitude': { $exists: true },
    'location.longitude': { $exists: true }
  }).select('googleId name email city location').lean();

  return users.filter(user => {
    const distance = calculateDistance(
      centerLat, centerLon,
      user.location.latitude, user.location.longitude
    );
    return distance <= radiusKm;
  }).map(user => ({
    ...user,
    distance: calculateDistance(
      centerLat, centerLon,
      user.location.latitude, user.location.longitude
    )
  }));
}

module.exports = {
  filterParticipantsByLocation,
  getLocationStats,
  getParticipantsByLocation,
  calculateDistance,
  filterByRadius
};
