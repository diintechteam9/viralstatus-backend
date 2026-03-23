const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const http = require('http');
const cors = require("cors");
const session = require('express-session');
const connectDB = require("./config/db");
const { configureCors } = require("./config/r2Cors");

// lead capture
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');


const userRoutes= require('./routes/userroutes')
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
const groupRoutes = require('./routes/grouproutes');
const campaignRoutes = require('./routes/campaignRoutes');
const poolRoutes = require('./routes/poolRoutes');
const imagePoolRoutes = require('./routes/imagePoolRoutes');
const ta1000seriesRoutes = require('./routes/ta1000series');
const videomergeta1000seriesRoutes = require('./routes/videomergeta1000series');
const creditWalletRoutes = require("./routes/creditWalletRoute");

// for whatsapp
const requestedTemplateRoutes = require("./routes/whatsapp/requestedTemplateRoutes");
const createRequestedTemplateRoutes = require("./routes/whatsapp/createRequestedTemplateRoute");
const whatsappRoutes=require('./routes/whatsapp/whatsapproute');
const phonenumberRoutes=require('./routes/whatsapp/phonenumberroute');
const messageRoutes=require('./routes/whatsapp/messageroute');


const videocardRoute=require('./routes/aivideogen');  // generate videocard
const heygenRoutes = require('./routes/heygenRoutes');  // HeyGen video generation
const videoCompressionRoutes = require('./routes/videoCompressionRoutes');  // video compression
const telegramRoute=require('./routes/telegramroutes');// telegram
const telegramWebhookRoute = require('./routes/telegram/telegramwebhookroute');
const telegramSettingsRoute = require('./routes/telegram/telegramSettingsRoute');
const videoToReelsRoutes = require('./routes/videoToReels');  // video to reel tool 
const audioExtractionRoutes = require('./routes/audioExtraction');  // async audio extraction
const subtitlesRoutes = require('./routes/subtitles');
const videoToSegmentsRoutes = require('./routes/videotosegments');
const websiteAnalyzerRoutes = require('./routes/websiteAnalyzerRoutes');  // website analyzer
const websiteRoutes = require('./routes/websiteRoutes');
const newsGeneratorRoute = require('./routes/newsGeneratorRoute');
const blogGeneratorRoute = require('./routes/blogGeneratorRoute');
const qnaGeneratorRoute = require('./routes/qnaGeneratorRoute');
const reelGeneratorRoute = require('./routes/reelGeneratorRoute');
const reviewGeneratorRoute = require('./routes/reviewGeneratorRoute');
const carouselGeneratorRoute = require('./routes/carouselGeneratorRoute');
const infographicGeneratorRoute = require('./routes/infographicGeneratorRoute');
const podcastGeneratorRoute = require('./routes/podcastGeneratorRoute');
const trendGeneratorRoute = require('./routes/trendGeneratorRoute');
const captionGeneratorRoute = require('./routes/captionGeneratorRoute');
const productComparatorRoute = require('./routes/productComparatorRoute');
const tripAdvisorRoute = require('./routes/tripAdvisorRoute');
const itineraryRoute = require('./routes/itineraryRoute');
const landingPageRoute = require('./routes/landingPageRoute');
const agentRoute = require('./routes/agentRoute');

// lead capture routes
const cardRoutes = require('./routes/leadcapture/cardRoutes');
const phoneNumberRoutes = require('./routes/leadcapture/phoneNumberRoutes');
const screenshotRoutes = require('./routes/leadcapture/screenshotRoutes');

const {
  startTemplateSyncScheduler,
  stopTemplateSyncScheduler,
} = require("./services/whatsappTemplateSyncScheduler");

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const { setIO } = require('./socket');

// Increase payload size limit to handle large base64 data
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

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
            "https://viralstatus-frontend.vercel.app/",
            "https://viralstatus-frontend-qiuf.vercel.app",
            "http://localhost:5173",
            "http://13.200.235.104:4000",
            "https://vs.yovoai.com",
            "http://localhost:4000"
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
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

// Additional CORS middleware for all routes
app.use((req, res, next) => {
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Origin', req.headers.origin || 'https://viralstatus-frontend.vercel.app' || 'https://client.yovoai.com');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.status(200).end();
        return;
    }
    
    // Add CORS headers for all responses
    res.header('Access-Control-Allow-Origin', req.headers.origin || 'https://viralstatus-frontend.vercel.app');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    next();
});

// Configure CORS for R2
configureCors();

const PORT = process.env.PORT || 4000;

app.get("/", (req, res) => {
    res.json({
        status: "success",
        message: "Viral Status API is running",
        timestamp: new Date().toISOString()
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

app.use('/api/datastore', datastoreRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/images', videoMergeRoutes);
app.use('/api/video', videoOverlayRoutes);

// Auth Routes for instagram and youtube
// app.use('/api/instagram/reels', instagramReelsRoutes);
app.use('/api/youtube', ytUploadRoutes);
// app.use('/api/webhooks', webhookRoutes);
// app.use('/auth/instagram', instagramAuthRoutes);
app.use('/auth/youtube', youtubeAuthRoutes);
// app.use('/api/instagram/api', apiInstagramRoutes);
// app.use('/api/posts', postRoutes);

// Google Authentication Routes
app.use('/api/auth/google', googleAuthRoutes);

app.use('/api/user', require('./routes/userroutes'));
app.use('/api/client', clientRoutes); 
app.use('/api/admin', adminRoutes);
app.use('/api/superadmin', superadminRoutes);

// User Profile Routes
app.use('/api/auth/user/profiles', userProfileRoutes);

// Group Routes
// app.use('/api/auth/user/group', groupRoutes);

// Campaign Routes
app.use('/api/auth/user/campaign', campaignRoutes);

// Pool Routes and Reel Routes (for uploading and managing reels)
app.use('/api/pools', poolRoutes);

// Image Pool Routes and Image Routes (for uploading and managing images)
app.use('/api/image-pools', imagePoolRoutes);

//credit Routes
app.use('/api/user/creditWallet', creditWalletRoutes);


// TA1000Series Routes
app.use('/api/ta1000series', ta1000seriesRoutes);
app.use('/api/reelta1000series', videomergeta1000seriesRoutes);


app.use('/api/videocard',videocardRoute);

// HeyGen Video Generation Routes
app.use('/api/heygen', heygenRoutes);

// Video Compression Routes
app.use('/api/compression', videoCompressionRoutes);

// Telegram Routes
app.use('/api/telegram', telegramRoute);
app.use('/api/telegram', telegramWebhookRoute);
app.use('/api/telegram', telegramSettingsRoute);

// Video to Reels (VTR) Routes
app.use('/api/vtr', videoToReelsRoutes);

// Audio Extraction Routes
app.use('/api/audio', audioExtractionRoutes);

// Subtitles Routes
app.use('/api/subtitles', subtitlesRoutes);

// Video To Segments (VTS) Routes
app.use('/api/vts', videoToSegmentsRoutes);

// Website Analyzer Routes
app.use('/api/website-analyzer', websiteAnalyzerRoutes);

// Website Analysis Routes
app.use('/api/website', websiteRoutes);
app.use('/api/news', newsGeneratorRoute);
app.use('/api/blog', blogGeneratorRoute);
app.use('/api/qna', qnaGeneratorRoute);
app.use('/api/reel', reelGeneratorRoute);
app.use('/api/review', reviewGeneratorRoute);
app.use('/api/carousel', carouselGeneratorRoute);
app.use('/api/infographic', infographicGeneratorRoute);
app.use('/api/podcast', podcastGeneratorRoute);
app.use('/api/trend', trendGeneratorRoute);
app.use('/api/caption', captionGeneratorRoute);
app.use('/api/product-comparator', productComparatorRoute);
app.use('/api/trip-advisor', tripAdvisorRoute);
app.use('/api/itinerary', itineraryRoute);
app.use('/api/landing-page', landingPageRoute);
app.use('/api/agent', agentRoute);

// Logging middleware (only in development)
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}


// for the whatsapp template 
app.use("/api/requested-templates", requestedTemplateRoutes);
app.use("/api/create-template",createRequestedTemplateRoutes );
app.use("/api/whatsapp",whatsappRoutes);
app.use('/api/phonenumber',phonenumberRoutes);
app.use('/api/chat',messageRoutes);

// Error handling middleware
app.use((error, req, res, next) => {
    if (process.env.NODE_ENV === 'development') {
        console.error('❌ Error:', error.message);
    }
    res.status(500).json({
        error: "Internal server error",
        message: error.message || "Something went wrong"
    });
});
// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve static files from uploads directory
app.use('/uploads', express.static(uploadsDir));

// Serve screenshots
const screenshotsDir = path.join(__dirname, 'uploads', 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}
app.use('/screenshots', express.static(screenshotsDir));

// API routes
app.use('/api/screenshots', screenshotRoutes);
app.use('/api/phone-numbers', phoneNumberRoutes);
app.use('/api/cards', cardRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: "Route not found",
        message: `Cannot ${req.method} ${req.url}`
    });
});

// Socket.io setup BEFORE server.listen()
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ["GET", "POST"],
        credentials: false
    },
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['polling']
});

setIO(io);

io.on('connection', (socket) => {
    console.log('✅ Socket.io client connected:', socket.id);
    
    // Client joins a room per waID
    socket.on('join', (waID) => {
        if (!waID) return;
        socket.join(waID);
        console.log(`📱 Socket ${socket.id} joined room: ${waID}`);
    });

    socket.on('leave', (waID) => {
        if (!waID) return;
        socket.leave(waID);
        console.log(`📱 Socket ${socket.id} left room: ${waID}`);
    });

    socket.on('disconnect', () => {
        console.log('❌ Socket.io client disconnected:', socket.id);
    });
});

connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`\n🚀 Server started successfully`);
        console.log(`📍 Port: ${PORT}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔌 Socket.io enabled on port ${PORT}`);
        console.log(`⏰ Time: ${new Date().toLocaleString()}\n`);
    });

    startTemplateSyncScheduler();

    // Graceful shutdown handling
    const gracefulShutdown = (signal) => {
        console.log(`\n⚠️  Received ${signal}. Shutting down gracefully...`);
        
        // Clean up video-to-reels job service timers
        try {
            const videoToReelsJobService = require('./services/videoToReelsJobService');
            videoToReelsJobService.cleanupTimers();
        } catch (error) {
            // Silent cleanup
        }
        
        // Clean up audio extraction job service timers
        try {
            const audioExtractionJobService = require('./services/audioExtractionJobService');
            audioExtractionJobService.cleanupTimers();
        } catch (error) {
            // Silent cleanup
        }

        try {
            stopTemplateSyncScheduler();
        } catch (error) {
            // Silent cleanup
        }
        
        // Close Socket.io connections
        io.close(() => {
            console.log('✅ Socket.io closed successfully');
        });
        
        server.close(() => {
            console.log('✅ Server closed successfully\n');
            process.exit(0);
        });
        
        // Force close after 10 seconds
        setTimeout(() => {
            console.error('⚠️  Forced shutdown after timeout\n');
            process.exit(1);
        }, 10000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
});