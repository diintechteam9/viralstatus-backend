const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const videoOverlayController = require('../controllers/videoOverlayController');

// Multer setup for file uploads
const upload = multer({ dest: path.join(__dirname, '../temp') });

// POST /api/video/overlay
router.post('/overlay', upload.fields([
  { name: 'mainVideo', maxCount: 1 },
  { name: 'overlayFile', maxCount: 1 }
]), videoOverlayController.overlayVideo);

module.exports = router; 