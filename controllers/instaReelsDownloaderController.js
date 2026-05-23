const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");

// Windows: use local yt-dlp.exe, Linux/Mac (production): use system yt-dlp
const YT_DLP = os.platform() === "win32"
  ? path.join(__dirname, "..", "yt-dlp.exe")
  : "/usr/local/bin/yt-dlp";

const isValidInstagramUrl = (url) => {
  try {
    const h = new URL(url).hostname;
    return h === "www.instagram.com" || h === "instagram.com";
  } catch { return false; }
};

// Run yt-dlp and return parsed JSON info
function ytDlpInfo(url) {
  return new Promise((resolve, reject) => {
    execFile(YT_DLP, ["--dump-json", "--no-playlist", url], { timeout: 30000 }, (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Failed to parse yt-dlp output")); }
    });
  });
}

// Download reel to temp file using yt-dlp
function ytDlpDownload(url, outPath) {
  return new Promise((resolve, reject) => {
    execFile(
      YT_DLP,
      ["-o", outPath, "--no-playlist", "--merge-output-format", "mp4", url],
      { timeout: 120000 },
      (err) => { if (err) return reject(err); resolve(); }
    );
  });
}

// ── GET INFO ──────────────────────────────────────────────────────────────────
exports.getReelInfo = async (req, res) => {
  const { url } = req.body;
  if (!url || !isValidInstagramUrl(url) || !url.includes("/reel/")) {
    return res.status(400).json({ error: "Invalid Instagram Reel URL." });
  }
  try {
    const info = await ytDlpInfo(url);
    res.json({
      title: info.title || "Instagram Reel",
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      uploader: info.uploader || info.channel || null,
      viewCount: info.view_count || null,
      likeCount: info.like_count || null,
      uploadDate: info.upload_date || null,
      type: "video",
      originalUrl: url,
    });
  } catch (e) {
    console.error("[InstaReels] yt-dlp info error:", e.message);
    res.status(500).json({ error: "Failed to fetch reel info. Make sure the reel is public." });
  }
};

// ── THUMBNAIL PROXY (not needed with yt-dlp, kept for compatibility) ──────────
exports.thumbnailProxy = (req, res) => res.status(404).end();

// ── DOWNLOAD ──────────────────────────────────────────────────────────────────
exports.downloadReel = async (req, res) => {
  const { url, title } = req.query;
  if (!url || !isValidInstagramUrl(url)) {
    return res.status(400).json({ error: "Invalid Instagram URL." });
  }
  const safeName = (title || "instagram_reel").replace(/[^a-z0-9]/gi, "_").substring(0, 80);
  const outPath = path.join(os.tmpdir(), `insta_${Date.now()}_${safeName}.mp4`);
  try {
    await ytDlpDownload(url, outPath);
    if (!fs.existsSync(outPath)) {
      return res.status(500).json({ error: "Download failed — file not created." });
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
    console.error("[InstaReels] yt-dlp download error:", e.message);
    if (fs.existsSync(outPath)) fs.unlink(outPath, () => {});
    res.status(500).json({ error: "Download failed. Reel may be private or unavailable." });
  }
};
