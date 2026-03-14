const { S3Client } = require("@aws-sdk/client-s3");
require('dotenv').config();

// Trim whitespace from credentials
const trimmedAccessKey = process.env.AWS_ACCESS_KEY_ID?.trim();
const trimmedSecretKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
const trimmedRegion = process.env.AWS_REGION?.trim();
const trimmedBucket = process.env.S3_BUCKET_NAME?.trim();

// Check if AWS credentials are configured
const hasAWSCredentials = trimmedAccessKey && 
                          trimmedSecretKey && 
                          trimmedRegion && 
                          trimmedBucket;

let s3Client = null;
let BUCKET_NAME = null;

if (hasAWSCredentials) {
    s3Client = new S3Client({
        region: trimmedRegion,
        credentials: {
            accessKeyId: trimmedAccessKey,
            secretAccessKey: trimmedSecretKey,
        }
    });
    BUCKET_NAME = trimmedBucket;
    console.log('✅ AWS S3 configured');
} else {
    console.log('⚠️  AWS S3 not configured - S3 features disabled');
}

module.exports = {
    s3: s3Client,
    BUCKET_NAME,
    isS3Enabled: hasAWSCredentials
}; 