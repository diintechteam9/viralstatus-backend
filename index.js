const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const session = require('express-session');
const connectDB = require("./config/db");
const { configureCors } = require("./config/s3Cors");

const clientRoutes = require("./routes/clientroutes");
const adminRoutes = require("./routes/adminroutes");
const superadminRoutes = require("./routes/superadminroutes");
const datastoreRoutes = require("./routes/datastoreroutes");  
const categoryRoutes = require('./routes/categoryroutes');
const folderRoutes = require('./routes/folderroutes');
const videoMergeRoutes = require('./routes/videomerge');
const videoOverlayRoutes = require('./routes/videooverlay');
const instagramReelsRoutes = require('./routes/instagramReels');
const ytUploadRoutes = require('./routes/ytUpload');
const webhookRoutes = require('./routes/webhook');
const instagramAuthRoutes = require('./routes/instagramAuth');
const youtubeAuthRoutes = require('./routes/youtubeAuth');
const apiInstagramRoutes = require('./routes/apiInstagram');
const postRoutes = require('./routes/postRoutes');
const googleAuthRoutes = require('./routes/googleAuth');
const userProfileRoutes = require('./routes/userProfile');

dotenv.config();

const app = express();

// Increase payload size limit to handle large base64 data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Configure CORS for Express
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            "https://viralstatus-frontend.vercel.app",
            "http://localhost:5173",
            "http://13.200.235.104:4000",
            "https://legaleeai.com"
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin);
            callback(null, true); // Allow for development, restrict in production
        }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
        "Content-Type", 
        "Authorization", 
        "X-Requested-With", 
        "Accept",
        "Origin",
        "Access-Control-Request-Method",
        "Access-Control-Request-Headers"
    ],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    maxAge: 86400, // 24 hours
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Configure CORS for S3
configureCors().catch(console.error);

const PORT = process.env.PORT || 4000;

app.get("/", (req, res) => {
    res.send("Hello World");
});

app.use('/api/client', clientRoutes);   
app.use('/api/admin', adminRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/datastore', datastoreRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/images', videoMergeRoutes);
app.use('/api/video', videoOverlayRoutes);

// Auth Routes for instagram and youtube
app.use('/api/instagram/reels', instagramReelsRoutes);
app.use('/api/youtube/upload', ytUploadRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/auth/instagram', instagramAuthRoutes);
app.use('/auth/youtube', youtubeAuthRoutes);
app.use('/api/instagram/api', apiInstagramRoutes);
app.use('/api/posts', postRoutes);

// Google Authentication Routes
app.use('/api/auth/google', googleAuthRoutes);

// User Profile Routes
app.use('/api/auth/user/profiles', userProfileRoutes);

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: "Internal server error",
        message: error.message || "Something went wrong"
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: "Route not found",
        message: `Cannot ${req.method} ${req.url}`
    });
});

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log("Server is running on port 4000");
    });
});


