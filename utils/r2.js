const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { r2Client } = require('../config/r2');

const BUCKET = process.env.R2_BUCKET;

const putobject = async (key, contentType) => {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(r2Client, command, { expiresIn: 3600 });
};

const getobject = async (key) => { 
  if (!key) return "";
  if (key.startsWith("http://") || key.startsWith("https://")) {
    return key;
  }
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key, ResponseContentDisposition: 'inline' });
  return getSignedUrl(r2Client, command, { expiresIn: 604800 });
};

const deleteObject = async (key) => {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
  await r2Client.send(command);
};

module.exports = { s3Client: r2Client, putobject, getobject, deleteObject };
