// utils/s3.js
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
require('dotenv').config();

// Trim whitespace from environment variables
const trimmedAccessKey = process.env.AWS_ACCESS_KEY_ID?.trim();
const trimmedSecretKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
const trimmedRegion = process.env.AWS_REGION?.trim();
const trimmedBucket = process.env.S3_BUCKET_NAME?.trim();

// Validate required environment variables
const requiredEnvVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET_NAME'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]?.trim());

if (missingEnvVars.length > 0) {
  console.error('Missing required AWS environment variables:', missingEnvVars);
  process.exit(1);
}

const s3Client = new S3Client({
  region: trimmedRegion,
  credentials: {
    accessKeyId: trimmedAccessKey,
    secretAccessKey: trimmedSecretKey,
  },
});

// Generate presigned URL for uploading
const putobject = async (key, contentType) => {
  try {
    const command = new PutObjectCommand({
      Bucket: trimmedBucket,
      Key: key,
      ContentType: contentType,
    });

    const signedUrl = await getSignedUrl(s3Client, command,{expiresIn:604800});
    return signedUrl;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw error;
  }
};

// Generate presigned URL for getting/reading an object
const getobject = async (key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: trimmedBucket,
      Key: key,
      ResponseContentDisposition: 'inline',
    });

    const signedUrl = await getSignedUrl(s3Client, command,{expiresIn:604800});
    return signedUrl;
  } catch (error) {
    console.error('Error generating get presigned URL:', error);
    throw error;
  }
};

const deleteObject = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: trimmedBucket,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error('Error deleting object:', error);
    throw error;
  }
};

module.exports = {
  s3Client,
  putobject,
  getobject,
  deleteObject,
};