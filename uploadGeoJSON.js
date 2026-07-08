require('dotenv').config();
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { r2Client } = require('./config/r2');
const fs = require('fs');
const path = require('path');

async function uploadGeoJSON() {
  try {
    // Sample India pincodes GeoJSON - minimal structure for testing
    const sampleGeoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [77.0, 28.4],
              [77.2, 28.4],
              [77.2, 28.6],
              [77.0, 28.6],
              [77.0, 28.4]
            ]]
          },
          properties: {
            pincode: '110001',
            city: 'Delhi',
            state: 'Delhi',
            area: 'New Delhi',
            name: 'New Delhi'
          }
        },
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [72.8, 19.0],
              [73.0, 19.0],
              [73.0, 19.2],
              [72.8, 19.2],
              [72.8, 19.0]
            ]]
          },
          properties: {
            pincode: '400001',
            city: 'Mumbai',
            state: 'Maharashtra',
            area: 'Fort',
            name: 'Fort'
          }
        },
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [77.5, 12.9],
              [77.7, 12.9],
              [77.7, 13.1],
              [77.5, 13.1],
              [77.5, 12.9]
            ]]
          },
          properties: {
            pincode: '560001',
            city: 'Bangalore',
            state: 'Karnataka',
            area: 'Bangalore City',
            name: 'Bangalore City'
          }
        }
      ]
    };

    const geoJSONString = JSON.stringify(sampleGeoJSON, null, 2);
    
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: 'geojson/india-pincodes.geojson',
      Body: geoJSONString,
      ContentType: 'application/json'
    });
    
    await r2Client.send(command);
    console.log('✅ GeoJSON file uploaded to R2 at: geojson/india-pincodes.geojson');
    console.log('📊 Sample data includes pincodes for: Delhi, Mumbai, Bangalore');
    
  } catch (error) {
    console.error('❌ Error uploading GeoJSON:', error.message);
  }
}

uploadGeoJSON();
