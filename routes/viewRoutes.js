const express = require("express");
const router = express.Router();
const { scrapeViews } = require("../scrapers/viewScraper");

router.post("/scrape-views", async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls)) {
    return res.status(400).json({ error: "urls must be an array" });
  }
  try {
    const data = await scrapeViews(urls);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;