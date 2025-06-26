const { PutBucketCorsCommand } = require("@aws-sdk/client-s3");
const { s3, BUCKET_NAME } = require("./s3");

const corsConfig = {
    CORSRules: [
        {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
            AllowedOrigins: [
                "http://localhost:5173",
                // "https://viral-status.vercel.app",
                "https://viralstatus-frontend.vercel.app",
            ],
            // ExposeHeaders: ["ETag"],
            ExposeHeaders: [],
            MaxAgeSeconds: 3600
        }
    ]
};

const configureCors = async () => {
    try {
        const command = new PutBucketCorsCommand({
            Bucket: BUCKET_NAME,
            CORSConfiguration: corsConfig
        });

        await s3.send(command);
        console.log('Successfully configured CORS for S3 bucket');
    } catch (error) {
        console.error('Error configuring CORS for S3 bucket:', error);
    }
};

module.exports = { configureCors };