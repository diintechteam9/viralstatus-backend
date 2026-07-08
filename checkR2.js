require('dotenv').config();
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { r2Client } = require('./config/r2');

async function checkR2() {
  try {
    console.log('Checking R2 bucket:', process.env.R2_BUCKET);
    
    const command = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET,
      Prefix: 'geojson/'
    });
    
    const response = await r2Client.send(command);
    
    console.log('\n📁 Files in geojson/ folder:');
    if (response.Contents && response.Contents.length > 0) {
      response.Contents.forEach(obj => {
        console.log(`  - ${obj.Key} (${obj.Size} bytes)`);
      });
    } else {
      console.log('  ❌ No files found in geojson/ folder');
    }
    
    // Check all files
    console.log('\n📁 All files in bucket:');
    const allCommand = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET,
      MaxKeys: 50
    });
    
    const allResponse = await r2Client.send(allCommand);
    if (allResponse.Contents && allResponse.Contents.length > 0) {
      allResponse.Contents.forEach(obj => {
        console.log(`  - ${obj.Key}`);
      });
    } else {
      console.log('  ❌ Bucket is empty');
    }
    
  } catch (error) {
    console.error('❌ Error checking R2:', error.message);
  }
}

checkR2();
