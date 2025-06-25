const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Configure multer for video upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only video files
  if (file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only video files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 1
  }
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

router.post('/upload', (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ 
        error: err.message,
        stage: 'file_upload'
      });
    }

    try {
      // Validate request
      if (!req.file) {
        return res.status(400).json({ 
          error: 'No video file provided',
          stage: 'file_validation'
        });
      }

      const { title, description } = req.body;
      if (!title) {
        return res.status(400).json({ 
          error: 'Title is required',
          stage: 'input_validation'
        });
      }

      // Check authentication
      const { tokens } = req.session;
      if (!tokens) {
        // Clean up uploaded file
        if (req.file) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(401).json({ 
          error: "Not authenticated. Please reconnect your YouTube account.",
          stage: 'authentication'
        });
      }

      // Initialize YouTube API
      const auth = new google.auth.OAuth2();
      auth.setCredentials(tokens);
      const youtube = google.youtube({ version: 'v3', auth });

      try {
        // Upload to YouTube
        const response = await youtube.videos.insert({
          part: 'snippet,status',
          requestBody: {
            snippet: {
              title: `${title} #Shorts`,
              description: description || title,
              categoryId: '22'
            },
            status: {
              privacyStatus: 'public'
            }
          },
          media: {
            body: fs.createReadStream(req.file.path),
          }
        });

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        // Return success response
        res.json({ 
          videoId: response.data.id,
          message: 'Video uploaded successfully',
          url: `https://youtube.com/watch?v=${response.data.id}`
        });

      } catch (youtubeError) {
        // Clean up uploaded file if it exists
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        // Handle specific YouTube API errors
        if (youtubeError.code === 401) {
          return res.status(401).json({ 
            error: 'YouTube authentication expired. Please reconnect your account.',
            stage: 'youtube_auth',
            details: youtubeError.message
          });
        }
        
        if (youtubeError.code === 403) {
          return res.status(403).json({ 
            error: 'Permission denied. Please check your YouTube account permissions.',
            stage: 'youtube_permission',
            details: youtubeError.message
          });
        }

        throw youtubeError; // Let the outer catch handle other errors
      }

    } catch (err) {
      // Clean up uploaded file if it exists
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      // Send appropriate error response
      res.status(500).json({ 
        error: 'Failed to upload video to YouTube',
        stage: 'general',
        details: err.message,
        apiError: err.response?.data
      });
    }
  });
});

module.exports = router;
