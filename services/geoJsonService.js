const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { r2Client } = require('../config/r2');

const BUCKET = process.env.R2_BUCKET;
const GEOJSON_KEY = 'geojson/india-pincodes.geojson';

let cachedGeoJSON = null;
let cachedPincodeIndex = null;
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
    const parsed = JSON.parse(body);
    
    if (!parsed.type || !parsed.features || !Array.isArray(parsed.features)) {
      console.error('Invalid GeoJSON structure');
      return null;
    }
    
    return parsed;
  } catch (error) {
    console.error('Error fetching GeoJSON from R2:', error.message);
    return null;
  }
}

/**
 * Build pincode index for O(1) lookup
 */
function buildPincodeIndex(geoJSON) {
  const index = new Map();
  if (!geoJSON || !geoJSON.features) return index;
  
  geoJSON.features.forEach((feature, idx) => {
    if (!feature.properties) return;
    const pincode = String(
      feature.properties.pincode || 
      feature.properties.postal_code || 
      feature.properties.code || 
      ''
    ).trim();
    if (pincode) index.set(pincode, idx);
  });
  
  return index;
}

/**
 * Get GeoJSON with caching and indexing
 */
async function getGeoJSON() {
  try {
    const now = Date.now();
    
    if (cachedGeoJSON && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
      return cachedGeoJSON;
    }
    
    const geoJSON = await fetchGeoJSONFromR2();
    if (geoJSON) {
      cachedGeoJSON = geoJSON;
      cachedPincodeIndex = buildPincodeIndex(geoJSON);
      cacheTimestamp = now;
    }
    
    return geoJSON;
  } catch (error) {
    console.error('Error in getGeoJSON:', error.message);
    return null;
  }
}

/**
 * Get features for specific pincodes with O(1) index lookup
 */
async function getFeaturesByPincodes(pincodes) {
  try {
    const geoJSON = await getGeoJSON();
    if (!geoJSON || !geoJSON.features) {
      console.warn('No valid GeoJSON features found');
      return [];
    }
    
    // Ensure index exists
    if (!cachedPincodeIndex) {
      cachedPincodeIndex = buildPincodeIndex(geoJSON);
    }
    
    const matchedFeatures = [];
    for (const pincode of pincodes) {
      const idx = cachedPincodeIndex.get(String(pincode).trim());
      if (idx !== undefined && geoJSON.features[idx]) {
        matchedFeatures.push(geoJSON.features[idx]);
      }
    }
    
    console.log(`Matched ${matchedFeatures.length} features for ${pincodes.length} pincodes`);
    return matchedFeatures;
  } catch (error) {
    console.error('Error in getFeaturesByPincodes:', error.message);
    return [];
  }
}

/**
 * Get feature for single pincode
 */
async function getFeatureByPincode(pincode) {
  try {
    const geoJSON = await getGeoJSON();
    if (!geoJSON || !geoJSON.features) return null;
    
    if (!cachedPincodeIndex) {
      cachedPincodeIndex = buildPincodeIndex(geoJSON);
    }
    
    const idx = cachedPincodeIndex.get(String(pincode).trim());
    return idx !== undefined ? geoJSON.features[idx] : null;
  } catch (error) {
    console.error('Error in getFeatureByPincode:', error.message);
    return null;
  }
}

/**
 * Get bounds for pincodes
 */
async function getBoundsForPincodes(pincodes) {
  try {
    const features = await getFeaturesByPincodes(pincodes);
    if (features.length === 0) {
      console.warn('No features found for bounds calculation');
      return null;
    }
    
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    
    for (const feature of features) {
      if (!feature.geometry) continue;
      
      try {
        if (feature.geometry.type === 'Polygon' && feature.geometry.coordinates[0]) {
          feature.geometry.coordinates[0].forEach(coord => {
            if (Array.isArray(coord) && coord.length >= 2) {
              minLng = Math.min(minLng, coord[0]);
              maxLng = Math.max(maxLng, coord[0]);
              minLat = Math.min(minLat, coord[1]);
              maxLat = Math.max(maxLat, coord[1]);
            }
          });
        } else if (feature.geometry.type === 'MultiPolygon' && feature.geometry.coordinates) {
          feature.geometry.coordinates.forEach(polygon => {
            if (polygon[0]) {
              polygon[0].forEach(coord => {
                if (Array.isArray(coord) && coord.length >= 2) {
                  minLng = Math.min(minLng, coord[0]);
                  maxLng = Math.max(maxLng, coord[0]);
                  minLat = Math.min(minLat, coord[1]);
                  maxLat = Math.max(maxLat, coord[1]);
                }
              });
            }
          });
        }
      } catch (err) {
        console.warn('Error processing feature geometry:', err.message);
      }
    }
    
    if (minLat === Infinity || maxLat === -Infinity) {
      console.warn('Could not calculate valid bounds');
      return null;
    }
    
    return {
      northeast: { lat: maxLat, lng: maxLng },
      southwest: { lat: minLat, lng: minLng }
    };
  } catch (error) {
    console.error('Error in getBoundsForPincodes:', error.message);
    return null;
  }
}

/**
 * Get center point for pincodes
 */
async function getCenterForPincodes(pincodes) {
  try {
    const bounds = await getBoundsForPincodes(pincodes);
    if (!bounds) return null;
    
    return {
      lat: (bounds.northeast.lat + bounds.southwest.lat) / 2,
      lng: (bounds.northeast.lng + bounds.southwest.lng) / 2
    };
  } catch (error) {
    console.error('Error in getCenterForPincodes:', error.message);
    return null;
  }
}

/**
 * Create GeoJSON FeatureCollection for map
 */
async function createFeatureCollection(pincodes) {
  try {
    const features = await getFeaturesByPincodes(pincodes);
    
    return {
      type: 'FeatureCollection',
      features: features.map(feature => ({
        type: 'Feature',
        geometry: feature.geometry,
        properties: {
          pincode: feature.properties?.pincode || feature.properties?.postal_code || feature.properties?.code,
          city: feature.properties?.city,
          state: feature.properties?.state,
          area: feature.properties?.area,
          name: feature.properties?.name
        }
      }))
    };
  } catch (error) {
    console.error('Error in createFeatureCollection:', error.message);
    return {
      type: 'FeatureCollection',
      features: []
    };
  }
}

/**
 * Get pincode info
 */
async function getPincodeInfo(pincode) {
  try {
    const feature = await getFeatureByPincode(pincode);
    if (!feature) return null;
    
    return {
      pincode: feature.properties?.pincode || feature.properties?.postal_code || feature.properties?.code,
      city: feature.properties?.city,
      state: feature.properties?.state,
      area: feature.properties?.area,
      name: feature.properties?.name,
      geometry: feature.geometry
    };
  } catch (error) {
    console.error('Error in getPincodeInfo:', error.message);
    return null;
  }
}

/**
 * Get all pincodes from GeoJSON
 */
async function getAllPincodes() {
  try {
    const geoJSON = await getGeoJSON();
    if (!geoJSON || !geoJSON.features) return [];
    
    return geoJSON.features.map(feature => ({
      pincode: feature.properties?.pincode || feature.properties?.postal_code || feature.properties?.code,
      city: feature.properties?.city,
      state: feature.properties?.state,
      area: feature.properties?.area
    }));
  } catch (error) {
    console.error('Error in getAllPincodes:', error.message);
    return [];
  }
}

/**
 * Clear cache
 */
function clearCache() {
  cachedGeoJSON = null;
  cachedPincodeIndex = null;
  cacheTimestamp = null;
  console.log('GeoJSON cache cleared');
}

/**
 * Validate GeoJSON structure
 */
async function validateGeoJSON() {
  try {
    const geoJSON = await getGeoJSON();
    if (!geoJSON) {
      return { valid: false, message: 'GeoJSON not found in R2' };
    }
    
    if (!geoJSON.type || geoJSON.type !== 'FeatureCollection') {
      return { valid: false, message: 'Invalid GeoJSON type' };
    }
    
    if (!Array.isArray(geoJSON.features)) {
      return { valid: false, message: 'Features is not an array' };
    }
    
    const featureCount = geoJSON.features.length;
    const validFeatures = geoJSON.features.filter(f => f.geometry && f.properties).length;
    
    return {
      valid: validFeatures > 0,
      message: `Found ${validFeatures}/${featureCount} valid features`,
      totalFeatures: featureCount,
      validFeatures: validFeatures
    };
  } catch (error) {
    return { valid: false, message: error.message };
  }
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
  clearCache,
  validateGeoJSON,
  buildPincodeIndex
};
