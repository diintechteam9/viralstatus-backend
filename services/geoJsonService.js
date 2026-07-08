const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { r2Client } = require('../config/r2');

const BUCKET = process.env.R2_BUCKET;
const GEOJSON_KEY = 'geojson/india-pincodes.geojson';

let cachedGeoJSON = null;
let cacheTimestamp = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch GeoJSON from R2
 */
async function fetchGeoJSONFromR2() {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: GEOJSON_KEY
    });
    
    const response = await r2Client.send(command);
    const body = await response.Body.transformToString();
    return JSON.parse(body);
  } catch (error) {
    console.error('Error fetching GeoJSON from R2:', error);
    return null;
  }
}

/**
 * Get GeoJSON with caching
 */
async function getGeoJSON() {
  const now = Date.now();
  
  if (cachedGeoJSON && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedGeoJSON;
  }
  
  const geoJSON = await fetchGeoJSONFromR2();
  if (geoJSON) {
    cachedGeoJSON = geoJSON;
    cacheTimestamp = now;
  }
  
  return geoJSON;
}

/**
 * Get features for specific pincodes
 */
async function getFeaturesByPincodes(pincodes) {
  const geoJSON = await getGeoJSON();
  if (!geoJSON || !geoJSON.features) return [];
  
  const pincodeSet = new Set(pincodes.map(p => String(p)));
  return geoJSON.features.filter(feature => {
    const pincode = feature.properties?.pincode || feature.properties?.postal_code;
    return pincodeSet.has(String(pincode));
  });
}

/**
 * Get feature for single pincode
 */
async function getFeatureByPincode(pincode) {
  const geoJSON = await getGeoJSON();
  if (!geoJSON || !geoJSON.features) return null;
  
  return geoJSON.features.find(feature => {
    const featurePincode = feature.properties?.pincode || feature.properties?.postal_code;
    return String(featurePincode) === String(pincode);
  });
}

/**
 * Get bounds for pincodes
 */
async function getBoundsForPincodes(pincodes) {
  const features = await getFeaturesByPincodes(pincodes);
  if (features.length === 0) return null;
  
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  
  features.forEach(feature => {
    if (feature.geometry.type === 'Polygon') {
      feature.geometry.coordinates[0].forEach(coord => {
        minLng = Math.min(minLng, coord[0]);
        maxLng = Math.max(maxLng, coord[0]);
        minLat = Math.min(minLat, coord[1]);
        maxLat = Math.max(maxLat, coord[1]);
      });
    } else if (feature.geometry.type === 'MultiPolygon') {
      feature.geometry.coordinates.forEach(polygon => {
        polygon[0].forEach(coord => {
          minLng = Math.min(minLng, coord[0]);
          maxLng = Math.max(maxLng, coord[0]);
          minLat = Math.min(minLat, coord[1]);
          maxLat = Math.max(maxLat, coord[1]);
        });
      });
    }
  });
  
  return {
    northeast: { lat: maxLat, lng: maxLng },
    southwest: { lat: minLat, lng: minLng }
  };
}

/**
 * Get center point for pincodes
 */
async function getCenterForPincodes(pincodes) {
  const bounds = await getBoundsForPincodes(pincodes);
  if (!bounds) return null;
  
  return {
    lat: (bounds.northeast.lat + bounds.southwest.lat) / 2,
    lng: (bounds.northeast.lng + bounds.southwest.lng) / 2
  };
}

/**
 * Create GeoJSON FeatureCollection for map
 */async function createFeatureCollection(pincodes) {
  const features = await getFeaturesByPincodes(pincodes);
  
  return {
    type: 'FeatureCollection',
    features: features.map(feature => ({
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        pincode: feature.properties?.pincode || feature.properties?.postal_code,
        city: feature.properties?.city,
        state: feature.properties?.state,
        area: feature.properties?.area,
        name: feature.properties?.name
      }
    }))
  };
}

/**
 * Get pincode info
 */
async function getPincodeInfo(pincode) {
  const feature = await getFeatureByPincode(pincode);
  if (!feature) return null;
  
  return {
    pincode: feature.properties?.pincode || feature.properties?.postal_code,
    city: feature.properties?.city,
    state: feature.properties?.state,
    area: feature.properties?.area,
    name: feature.properties?.name,
    geometry: feature.geometry
  };
}

/**
 * Get all pincodes from GeoJSON
 */
async function getAllPincodes() {
  const geoJSON = await getGeoJSON();
  if (!geoJSON || !geoJSON.features) return [];
  
  return geoJSON.features.map(feature => ({
    pincode: feature.properties?.pincode || feature.properties?.postal_code,
    city: feature.properties?.city,
    state: feature.properties?.state,
    area: feature.properties?.area
  }));
}

/**
 * Clear cache
 */
function clearCache() {
  cachedGeoJSON = null;
  cacheTimestamp = null;
}

module.exports = {
  getGeoJSON,
  getFeaturesByPincodes,
  getFeatureByPincode,
  getBoundsForPincodes,
  getCenterForPincodes,
  createFeatureCollection,
  getPincodeInfo,
  getAllPincodes,
  clearCache
};
