const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const videoMergeController = require("../controllers/videomergecontroller");

// Test route (no auth required)
router.get("/test", videoMergeController.testEndpoint);

// Protected routes
router.use(protect);

router.get("/merge", (req, res) => {
    res.send("this is video merge ");
});

router.post("/merge", videoMergeController.mergeVideos);

// Merge videos

module.exports = router; 