const axios = require('axios');

/**
 * Parse latitude/longitude from mobile payload.
 * Accepts: latitude/longitude, lat/lng, lat/lon
 */
function parseCoords(body = {}) {
  const lat = Number(body.latitude ?? body.lat);
  const lng = Number(body.longitude ?? body.lng ?? body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * Reverse geocode via OpenStreetMap Nominatim (no API key).
 */
async function reverseGeocode(lat, lng) {
  const res = await axios.get('https://nominatim.openstreetmap.org/reverse', {
    params: {
      lat,
      lon: lng,
      format: 'json',
      addressdetails: 1,
      zoom: 14,
    },
    headers: {
      'User-Agent': process.env.NOMINATIM_USER_AGENT || 'YovoAI-MobileApp/1.0 (contact@yovoai.com)',
      Accept: 'application/json',
    },
    timeout: 10000,
  });

  const addr = res.data?.address || {};
  return {
    formattedAddress: res.data?.display_name || '',
    city:
      addr.city ||
      addr.town ||
      addr.village ||
      addr.suburb ||
      addr.county ||
      addr.state_district ||
      '',
    state: addr.state || '',
    country: addr.country || '',
    pincode: addr.postcode || '',
  };
}

/**
 * Build MongoDB update fields for user location.
 */
async function buildLocationPayload(body = {}) {
  const coords = parseCoords(body);
  if (!coords) return null;

  let address = {
    formattedAddress: String(body.address || body.formattedAddress || '').trim(),
    city: String(body.city || '').trim(),
    state: String(body.state || '').trim(),
    country: String(body.country || '').trim(),
    pincode: String(body.pincode || body.postcode || '').trim(),
  };

  if (!address.city && !address.formattedAddress) {
    try {
      address = await reverseGeocode(coords.lat, coords.lng);
    } catch (err) {
      console.warn('[userLocation] reverse geocode failed:', err.message);
    }
  }

  const optionalNum = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const payload = {
    location: {
      latitude: coords.lat,
      longitude: coords.lng,
      accuracy: optionalNum(body.accuracy),
      altitude: optionalNum(body.altitude),
      heading: optionalNum(body.heading),
      speed: optionalNum(body.speed),
    },
    locationAddress: address,
    locationUpdatedAt: new Date(),
  };

  if (address.city) payload.city = address.city;
  if (address.pincode) payload.pincode = address.pincode;

  return payload;
}

function formatLocationResponse(user) {
  if (!user) return null;
  return {
    latitude: user.location?.latitude ?? null,
    longitude: user.location?.longitude ?? null,
    accuracy: user.location?.accuracy ?? null,
    address: user.locationAddress || null,
    city: user.city || user.locationAddress?.city || null,
    pincode: user.pincode || user.locationAddress?.pincode || null,
    updatedAt: user.locationUpdatedAt || null,
  };
}

module.exports = {
  parseCoords,
  reverseGeocode,
  buildLocationPayload,
  formatLocationResponse,
};
