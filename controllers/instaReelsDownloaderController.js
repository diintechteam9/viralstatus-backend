const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const YT_DLP = path.join(__dirname, "..", "yt-dlp.exe");
const FFMPEG_DIR = path.join(__dirname, "..", "ffmpeg-8.1.1-essentials_build", "bin");

// In-memory thumbnail cache (token → temp file path)
const thumbCache = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

const isValidInstagramUrl = (url) => {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "www.instagram.com" ||
      parsed.hostname === "instagram.com"
    );
  } catch {
    return false;
  }
};

const parseJsonFromStdout = (stdout) => {
  const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  if (lines.length === 0) throw new Error("No JSON found in yt-dlp output");
  return lines.map((l) => JSON.parse(l));
};

const YT_DLP_ARGS = [
  "--no-check-certificates",
  "--user-agent",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "--add-header",
  "Accept-Language:en-US,en;q=0.9",
];

// ── Controller: GET INFO ──────────────────────────────────────────────────────

exports.getReelInfo = (req, res) => {
  const { url } = req.body;

  if (!url || !isValidInstagramUrl(url) || !url.includes("/reel/")) {
    return res.status(400).json({ error: "Invalid Instagram Reel URL. Use format: https://www.instagram.com/reel/XXXXX/" });
  }

  if (!fs.existsSync(YT_DLP)) {
    return res.status(500).json({ error: "yt-dlp.exe not found on server. Please contact admin." });
  }

  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const thumbBase = path.join(os.tmpdir(), `insta_thumb_${token}`);
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`;

  // Single yt-dlp call: dump JSON + write thumbnail + skip video download
  const args = [
    "--dump-json",
    "--no-playlist",
    "--write-thumbnail",
    "--skip-download",
    "--convert-thumbnails", "jpg",
    "-o", thumbBase,
    ...YT_DLP_ARGS,
    url,
  ];

  execFile(YT_DLP, args, { timeout: 35000 }, (err, stdout, stderr) => {
    if (err) {
      const msg = (stderr || "").toLowerCase();
      if (msg.includes("private") || msg.includes("login required")) {
        return res.status(403).json({ error: "Private account. Only public Instagram Reels are supported." });
      }
      if (msg.includes("not found") || msg.includes("does not exist")) {
        return res.status(404).json({ error: "Reel not found. Please check the URL." });
      }
      console.error("[InstaReels] yt-dlp error:", stderr);
      return res.status(500).json({ error: "Failed to fetch reel info. The reel may be unavailable." });
    }

    try {
      const infos = parseJsonFromStdout(stdout);
      const info = infos[0];

      // Find the downloaded thumbnail file (.jpg or .webp)
      let thumbFilePath = null;
      for (const ext of [".jpg", ".jpeg", ".webp", ".png"]) {
        const candidate = `${thumbBase}${ext}`;
        if (fs.existsSync(candidate)) { thumbFilePath = candidate; break; }
      }

      let thumbnailServeUrl = null;
      if (thumbFilePath) {
        thumbCache.set(token, thumbFilePath);
        // Auto-delete after 10 minutes
        setTimeout(() => {
          const p = thumbCache.get(token);
          if (p && fs.existsSync(p)) fs.unlink(p, () => {});
          thumbCache.delete(token);
        }, 10 * 60 * 1000);
        thumbnailServeUrl = `${backendUrl}/api/insta-reels/thumbnail?token=${token}`;
      }

      res.json({
        title: info.title || "Instagram Reel",
        thumbnail: thumbnailServeUrl,
        duration: info.duration || null,
        uploader: info.uploader || info.channel || null,
        viewCount: info.view_count || null,
        likeCount: info.like_count || null,
        uploadDate: info.upload_date || null,
        type: "video",
        originalUrl: url,
      });
    } catch (e) {
      console.error("[InstaReels] JSON parse error:", e.message);
      res.status(500).json({ error: "Failed to parse reel data." });
    }
  });
};

// ── Controller: THUMBNAIL SERVE (from temp file) ─────────────────────────────

exports.thumbnailProxy = (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).end();

  const filePath = thumbCache.get(token);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).end();
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=600");
  res.setHeader("Access-Control-Allow-Origin", "*");
  fs.createReadStream(filePath).pipe(res);
};

// ── Controller: DOWNLOAD ──────────────────────────────────────────────────────

exports.downloadReel = (req, res) => {
  const { url, title } = req.query;

  if (!url || !isValidInstagramUrl(url)) {
    return res.status(400).json({ error: "Invalid Instagram URL." });
  }

  if (!fs.existsSync(YT_DLP)) {
    return res.status(500).json({ error: "yt-dlp.exe not found on server." });
  }

  const safeName = (title || "instagram_reel")
    .replace(/[^a-z0-9]/gi, "_")
    .substring(0, 80);
  const outPath = path.join(os.tmpdir(), `insta_${Date.now()}_${safeName}.mp4`);

  const ffmpegAvailable = fs.existsSync(path.join(FFMPEG_DIR, "ffmpeg.exe"));

  const args = [
    "--no-playlist",
    ...YT_DLP_ARGS,
    ...(ffmpegAvailable
      ? [
          "--ffmpeg-location", FFMPEG_DIR,
          "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best",
          "--merge-output-format", "mp4",
        ]
      : ["-f", "best[ext=mp4]/best"]),
    "-o", outPath,
    url,
  ];

  execFile(YT_DLP, args, { timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      console.error("[InstaReels] Download error:", stderr);
      // Cleanup partial file
      if (fs.existsSync(outPath)) fs.unlink(outPath, () => {});
      return res.status(500).json({ error: "Download failed. Please try again." });
    }

    if (!fs.existsSync(outPath)) {
      return res.status(500).json({ error: "File was not created. Download may have failed." });
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
  });
};
