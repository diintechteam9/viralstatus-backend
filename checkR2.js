require('dotenv').config();
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { r2Client } = require('./config/r2');

async function checkR2() {
  try {
    console.log('Checking R2 bucket:', process.env.R2_BUCKET);
    
    // Check all files up to 1000
    console.log('\n📁 Listing files in bucket containing "geojson" or ".json":');
    const allCommand = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET,
      MaxKeys: 1000
    });
    
    const allResponse = await r2Client.send(allCommand);
    let found = false;
    if (allResponse.Contents && allResponse.Contents.length > 0) {
      allResponse.Contents.forEach(obj => {
        if (obj.Key.toLowerCase().includes('geojson') || obj.Key.toLowerCase().endsWith('.json')) {
          console.log(`  - ${obj.Key} (${obj.Size} bytes)`);
          found = true;
        }
      });
      if (!found) {
        console.log('  ❌ No JSON/GeoJSON files found in the bucket list (top 1000)');
      }
    } else {
      console.log('  ❌ Bucket is empty');
    }
    
  } catch (error) {
    console.error('❌ Error checking R2:', error.message);
  }
}

checkR2();
