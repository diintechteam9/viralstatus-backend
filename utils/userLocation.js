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
 * Reverse geocode via Google Geocoding API, falling back to OpenStreetMap Nominatim.
 */
async function reverseGeocode(lat, lng) {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    try {
      console.log('[userLocation] Querying Google Geocoding API for coordinates:', lat, lng);
      const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: {
          latlng: `${lat},${lng}`,
          key: googleKey
        },
        timeout: 5000
      });

      if (res.data && res.data.status === 'OK' && res.data.results && res.data.results.length > 0) {
        const firstResult = res.data.results[0];
        const components = firstResult.address_components || [];
        
        let city = '';
        let state = '';
        let country = '';
        let pincode = '';

        for (const comp of components) {
          const types = comp.types || [];
          if (types.includes('postal_code')) {
            pincode = comp.long_name;
          }
          if (types.includes('locality')) {
            city = comp.long_name;
          } else if (!city && types.includes('administrative_area_level_2')) {
            city = comp.long_name;
          }
          if (types.includes('administrative_area_level_1')) {
            state = comp.long_name;
          }
          if (types.includes('country')) {
            country = comp.long_name;
          }
        }

        console.log('[userLocation] Google Geocoding succeeded:', { city, pincode });
        return {
          formattedAddress: firstResult.formatted_address || '',
          city,
          state,
          country,
          pincode
        };
      } else {
        console.warn('[userLocation] Google Geocoding API status not OK:', res.data?.status);
      }
    } catch (googleErr) {
      console.warn('[userLocation] Google Geocoding failed, falling back to Nominatim:', googleErr.message);
    }
  }

  // Fallback: OpenStreetMap Nominatim reverse geocode at high precision (zoom=18)
  console.log('[userLocation] Querying OpenStreetMap Nominatim fallback geocode (zoom=18)');
  const res = await axios.get('https://nominatim.openstreetmap.org/reverse', {
    params: {
      lat,
      lon: lng,
      format: 'json',
      addressdetails: 1,
      zoom: 18,
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
