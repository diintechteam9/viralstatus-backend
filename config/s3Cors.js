const { PutBucketCorsCommand } = require("@aws-sdk/client-s3");
const { s3, BUCKET_NAME, isS3Enabled } = require("./s3");

const corsConfig = {
    CORSRules: [
        {
            AllowedHeaders: ["*"],
            AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
            AllowedOrigins: [
                "http://localhost:5173",
                "https://viralstatus-frontend.vercel.app",
                "https://vs.yovoai.com"
            ],
            ExposeHeaders: [],
            MaxAgeSeconds: 3600
        }
    ]
};

const configureCors = async () => {
    // Skip silently if S3 is not enabled
    if (!isS3Enabled || !s3 || !BUCKET_NAME) {
        return;
    }

    try {
        const command = new PutBucketCorsCommand({
            Bucket: BUCKET_NAME,
            CORSConfiguration: corsConfig
        });

        await s3.send(command);
        if (process.env.NODE_ENV === 'development') {
            console.log('✅ S3 CORS configured');
        }
    } catch (error) {
        // Silent fail - S3 CORS is not critical for server startup
        if (process.env.NODE_ENV === 'development') {
            console.warn('⚠️  S3 CORS configuration failed:', error.message);
        }
    }
};

module.exports = { configureCors };