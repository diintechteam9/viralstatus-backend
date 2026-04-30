const express = require("express");
const router = express.Router();
const https = require("https");
const http = require("http");
const { URL } = require("url");

const DRIVE_ID_REGEX = /^[a-zA-Z0-9_-]{10,60}$/;
const ALLOWED_DRIVE_HOSTS = ["www.googleapis.com", "drive.google.com"];

const validateDriveId = (id) => DRIVE_ID_REGEX.test(id);

// ─── Helper: HTTP GET with redirect follow, returns {res, body} ──────────────
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === "https:" ? https : http;
    lib.get(urlStr, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ res, body }));
    }).on("error", reject);
  });
}

// ─── Helper: stream HTTP GET response directly to express res ────────────────
function httpStream(urlStr, expressRes) {
  return new Promise((resolve, reject) => {
    const lib = urlStr.startsWith("https") ? https : http;
    lib.get(urlStr, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpStream(res.headers.location, expressRes).then(resolve).catch(reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 400) {
        return reject(new Error(`Drive returned HTTP ${res.statusCode}`));
      }
      expressRes.setHeader("Content-Type", res.headers["content-type"] || "video/mp4");
      if (res.headers["content-length"]) {
        expressRes.setHeader("Content-Length", res.headers["content-length"]);
      }
      res.pipe(expressRes);
      res.on("end", resolve);
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ─── GET /api/drive/list-files?type=folder|file&id=DRIVE_ID ──────────────────
router.get("/list-files", async (req, res) => {
  const { type, id } = req.query;
  if (!id) return res.status(400).json({ success: false, error: "id is required" });
  if (!validateDriveId(id)) return res.status(400).json({ success: false, error: "Invalid Drive ID format" });

  const apiKey = process.env.DRIVE_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, error: "DRIVE_API_KEY not configured on server" });

  try {
    if (type === "file") {
      const { body } = await httpGet(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime&key=${apiKey}`
      );
      const meta = JSON.parse(body);
      if (meta.error) throw new Error(meta.error.message || "Drive API error");
      const files = meta.mimeType?.startsWith("video/")
        ? [{ id: meta.id, name: meta.name, mimeType: meta.mimeType, size: parseInt(meta.size || 0), modifiedTime: meta.modifiedTime }]
        : [];
      return res.json({ success: true, files });
    }

    // Folder — paginate through all video files
    let files = [];
    let pageToken = "";
    do {
      const q = encodeURIComponent(`'${id}' in parents and mimeType contains 'video/' and trashed=false`);
      const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime)&pageSize=100&key=${apiKey}${pageParam}`;
      const { body } = await httpGet(url);
      const data = JSON.parse(body);
      if (data.error) throw new Error(data.error.message || "Drive API error");
      files = files.concat(data.files || []);
      pageToken = data.nextPageToken || "";
    } while (pageToken);

    res.json({
      success: true,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: parseInt(f.size || 0),
        modifiedTime: f.modifiedTime,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || "Drive listing failed" });
  }
});

// ─── GET /api/drive/download-file?fileId=DRIVE_FILE_ID ───────────────────────
// Streams the file from Drive to the client (bypasses browser CORS)
router.get("/download-file", async (req, res) => {
  const { fileId } = req.query;
  if (!fileId) return res.status(400).json({ success: false, error: "fileId is required" });
  if (!validateDriveId(fileId)) return res.status(400).json({ success: false, error: "Invalid fileId format" });

  const apiKey = process.env.DRIVE_API_KEY;
  const downloadUrl = apiKey
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${apiKey}`
    : `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;

  try {
    await httpStream(downloadUrl, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message || "Download failed" });
    }
  }
});

module.exports = router;
