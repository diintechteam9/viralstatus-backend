const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");

// In-memory thumbnail cache (token → url)
const thumbCache = new Map();

// ── RapidAPI call ─────────────────────────────────────────────────────────────
function fetchFromRapidAPI(reelUrl) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(reelUrl);
    const options = {
      method: "GET",
      hostname: "instagram-reels-downloader-api.p.rapidapi.com",
      path: `/download?url=${encoded}`,
      headers: {
        "x-rapidapi-key": process.env.RAPIDAPI_KEY,
        "x-rapidapi-host": "instagram-reels-downloader-api.p.rapidapi.com",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Failed to parse API response"));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("Request timeout")); });
    req.end();
  });
}

// ── Download video from URL to temp file ─────────────────────────────────────
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const get = (urlStr) => {
      const mod = urlStr.startsWith("https") ? require("https") : require("http");
      mod.get(urlStr, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with status ${res.statusCode}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      }).on("error", reject);
    };
    get(url);
  });
}

const isValidInstagramUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.instagram.com" || parsed.hostname === "instagram.com";
  } catch { return false; }
};

// ── Controller: GET INFO ──────────────────────────────────────────────────────
exports.getReelInfo = async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidInstagramUrl(url) || !url.includes("/reel/")) {
    return res.status(400).json({ error: "Invalid Instagram Reel URL." });
  }

  if (!process.env.RAPIDAPI_KEY) {
    return res.status(500).json({ error: "RapidAPI key not configured on server." });
  }

  try {
    const result = await fetchFromRapidAPI(url);

    if (!result.success || result.data?.error) {
      return res.status(403).json({ error: "Failed to fetch reel. It may be private or unavailable." });
    }

    const data = result.data;
    const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Cache thumbnail URL directly (no need to download)
    if (data.thumbnail) {
      thumbCache.set(token, { type: "url", url: data.thumbnail });
      setTimeout(() => thumbCache.delete(token), 10 * 60 * 1000);
    }

    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;

    res.json({
      title: data.title || "Instagram Reel",
      thumbnail: data.thumbnail ? `${backendUrl}/api/insta-reels/thumbnail?token=${token}` : null,
      duration: data.duration || null,
      uploader: data.owner?.username || data.author || null,
      viewCount: data.view_count || null,
      likeCount: data.like_count || null,
      uploadDate: null,
      type: "video",
      originalUrl: url,
      // Pass video URL for direct download
      _videoUrl: data.medias?.find(m => m.type === "video")?.url || null,
    });
  } catch (e) {
    console.error("[InstaReels] RapidAPI error:", e.message);
    res.status(500).json({ error: "Failed to fetch reel info. Please try again." });
  }
};

// ── Controller: THUMBNAIL PROXY ───────────────────────────────────────────────
exports.thumbnailProxy = (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).end();

  const cached = thumbCache.get(token);
  if (!cached) return res.status(404).end();

  // Proxy the thumbnail URL
  if (cached.type === "url") {
    const mod = cached.url.startsWith("https") ? require("https") : require("http");
    mod.get(cached.url, (imgRes) => {
      res.setHeader("Content-Type", imgRes.headers["content-type"] || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      imgRes.pipe(res);
    }).on("error", () => res.status(500).end());
    return;
  }

  // File-based (legacy)
  if (!fs.existsSync(cached)) return res.status(404).end();
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=600");
  res.setHeader("Access-Control-Allow-Origin", "*");
  fs.createReadStream(cached).pipe(res);
};

// ── Controller: DOWNLOAD ──────────────────────────────────────────────────────
exports.downloadReel = async (req, res) => {
  const { url, title } = req.query;

  if (!url || !isValidInstagramUrl(url)) {
    return res.status(400).json({ error: "Invalid Instagram URL." });
  }

  try {
    const result = await fetchFromRapidAPI(url);

    if (!result.success || result.data?.error) {
      return res.status(403).json({ error: "Reel unavailable or private." });
    }

    const videoMedia = result.data?.medias?.find(m => m.type === "video");
    if (!videoMedia?.url) {
      return res.status(404).json({ error: "No video found in this reel." });
    }

    const safeName = (title || "instagram_reel").replace(/[^a-z0-9]/gi, "_").substring(0, 80);
    const outPath = path.join(os.tmpdir(), `insta_${Date.now()}_${safeName}.mp4`);

    await downloadFile(videoMedia.url, outPath);

    if (!fs.existsSync(outPath)) {
      return res.status(500).json({ error: "File was not created." });
    }

    const stat = fs.statSync(outPath);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.mp4"`);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);

    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on("close", () => fs.unlink(outPath, () => {}));
    stream.on("error", () => {
      if (fs.existsSync(outPath)) fs.unlink(outPath, () => {});
      if (!res.headersSent) res.status(500).json({ error: "Stream error." });
    });
  } catch (e) {
    console.error("[InstaReels] Download error:", e.message);
    res.status(500).json({ error: "Download failed. Please try again." });
  }
};
