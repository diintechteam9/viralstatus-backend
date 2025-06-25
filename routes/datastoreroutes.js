const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const datastoreController = require("../controllers/datastorecontroller");

// Protected routes
router.use(protect);

// Create folder
// router.post("/create-folder", datastoreController.createFolder);

// Get upload URL
router.post("/upload-url", datastoreController.getUploadUrl);

// get the files from the mongodb
router.post("/files", datastoreController.listFiles);

// Get the files from the s3
router.post("/download-url", datastoreController.getDownloadUrl);

// Delete file
router.delete("/files", datastoreController.deleteFile);

module.exports = router;
