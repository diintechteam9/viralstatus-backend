const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const PoolFolder = require('../models/PoolFolder');
const Reel = require('../models/Reel');
const Pool = require('../models/pool');
const { putobject, getobject } = require('../utils/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../utils/r2');

// Resolve yt-dlp binary (same logic as instaReelsDownloaderController)
const LOCAL_YT_DLP = process.platform === 'win32'
  ? path.join(__dirname, '..', 'yt-dlp.exe')
  : path.join(__dirname, '..', 'yt-dlp');
const SYSTEM_YT_DLP_PATHS = ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', '/home/ubuntu/.local/bin/yt-dlp'];
function resolveYtDlp() {
  if (fs.existsSync(LOCAL_YT_DLP)) return LOCAL_YT_DLP;
  if (process.platform !== 'win32') {
    for (const p of SYSTEM_YT_DLP_PATHS) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
const YT_DLP = resolveYtDlp() || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

const FFMPEG_DIR = process.platform === 'win32'
  ? path.join(__dirname, '..', 'ffmpeg-8.1.1-essentials_build', 'bin')
  : '/usr/bin';

const COOKIES_PATH = path.join(__dirname, '..', 'cookies.txt');

const YT_DLP_ARGS = [
  '--no-check-certificates',
  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  '--add-header', 'Accept-Language:en-US,en;q=0.9',
  ...(fs.existsSync(COOKIES_PATH) ? ['--cookies', COOKIES_PATH] : []),
];

// ── Create Folder ─────────────────────────────────────────────────────────────
exports.createFolder = async (req, res) => {
  try {
    const { poolId } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Folder name is required' });

    const pool = await Pool.findById(poolId);
    if (!pool) return res.status(404).json({ error: 'Pool not found' });

    const existing = await PoolFolder.findOne({ poolId, name: name.trim() });
    if (existing) return res.status(400).json({ error: 'Folder with this name already exists in this pool' });

    const folder = await PoolFolder.create({ poolId, name: name.trim() });
    res.status(201).json({ success: true, folder });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create folder', details: err.message });
  }
};

// ── Get Folders by Pool ───────────────────────────────────────────────────────
exports.getFolders = async (req, res) => {
  try {
    const { poolId } = req.params;
    const folders = await PoolFolder.find({ poolId }).sort({ createdAt: -1 });
    res.json({ success: true, folders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch folders', details: err.message });
  }
};

// ── Delete Folder ─────────────────────────────────────────────────────────────
exports.deleteFolder = async (req, res) => {
  try {
    const { folderId } = req.params;
    const folder = await PoolFolder.findById(folderId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Move reels back to pool (unfolder them) or delete — here we just unlink
    await Reel.updateMany({ folderId }, { $set: { folderId: null } });
    await PoolFolder.findByIdAndDelete(folderId);
    res.json({ success: true, message: 'Folder deleted. Reels moved back to pool.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete folder', details: err.message });
  }
};

// ── Rename Folder ─────────────────────────────────────────────────────────────
exports.renameFolder = async (req, res) => {
  try {
    const { folderId } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Folder name is required' });

    const folder = await PoolFolder.findByIdAndUpdate(folderId, { name: name.trim() }, { new: true });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json({ success: true, folder });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename folder', details: err.message });
  }
};

// ── Get Reels in Folder ───────────────────────────────────────────────────────
exports.getReelsInFolder = async (req, res) => {
  try {
    const { folderId } = req.params;
    const reels = await Reel.find({ folderId }).sort({ createdAt: -1 });
    const reelsWithUrls = await Promise.all(reels.map(async (reel) => {
      try {
        const freshUrl = await getobject(reel.s3Key);
        return { ...reel.toObject(), s3Url: freshUrl };
      } catch {
        return reel.toObject();
      }
    }));
    res.json({ success: true, reels: reelsWithUrls });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reels', details: err.message });
  }
};

// ── Download Instagram Reel directly into Pool (no folder) ──────────────────
exports.downloadReelToPool = async (req, res) => {
  try {
    const { poolId } = req.params;
    const { url } = req.body;

    if (!url || !url.includes('instagram.com')) {
      return res.status(400).json({ error: 'Valid Instagram URL is required' });
    }

    const pool = await Pool.findById(poolId);
    if (!pool) return res.status(404).json({ error: 'Pool not found' });

    const safeName = `insta_${Date.now()}`;
    const outPath = path.join(os.tmpdir(), `${safeName}.mp4`);

    const ffmpegBin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const ffmpegAvailable = fs.existsSync(path.join(FFMPEG_DIR, ffmpegBin))
      || fs.existsSync('/usr/bin/ffmpeg')
      || fs.existsSync('/usr/local/bin/ffmpeg');

    const args = [
      '--no-playlist',
      ...YT_DLP_ARGS,
      ...(ffmpegAvailable
        ? [
            '--ffmpeg-location', fs.existsSync(path.join(FFMPEG_DIR, ffmpegBin)) ? FFMPEG_DIR : '/usr/bin',
            '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best',
            '--merge-output-format', 'mp4',
          ]
        : ['-f', 'best[ext=mp4]/best']),
      '-o', outPath,
      url,
    ];

    execFile(YT_DLP, args, { timeout: 120000 }, async (err, stdout, stderr) => {
      if (err) {
        console.error('[PoolDownload] yt-dlp error:', stderr || err.message);
        if (fs.existsSync(outPath)) fs.unlink(outPath, () => {});
        return res.status(500).json({ error: 'Failed to download reel. The reel may be private or unavailable.' });
      }

      if (!fs.existsSync(outPath)) {
        return res.status(500).json({ error: 'Downloaded file not found.' });
      }

      try {
        const fileBuffer = fs.readFileSync(outPath);
        const s3Key = `${poolId}/reels/${safeName}.mp4`;

        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: s3Key,
          Body: fileBuffer,
          ContentType: 'video/mp4',
          ContentLength: fileBuffer.length,
        }));

        fs.unlink(outPath, () => {});

        const s3Url = await getobject(s3Key);
        const reel = await Reel.create({
          poolId,
          s3Key,
          s3Url,
          title: `Instagram Reel - ${new Date().toLocaleDateString()}`,
        });

        await Pool.findByIdAndUpdate(poolId, { $inc: { reelCount: 1 } });
        res.status(201).json({ success: true, reel: { ...reel.toObject(), s3Url } });
      } catch (uploadErr) {
        if (fs.existsSync(outPath)) fs.unlink(outPath, () => {});
        console.error('[PoolDownload] Upload error:', uploadErr.message);
        res.status(500).json({ error: 'Failed to upload reel to storage.', details: uploadErr.message });
      }
    });
  } catch (err) {
    console.error('[PoolDownload] Unexpected error:', err.message);
    res.status(500).json({ error: 'Unexpected server error.', details: err.message });
  }
};

exports.downloadReelToFolder = async (req, res) => {
  try {
    const { folderId } = req.params;
    const { url } = req.body;

    if (!url || !url.includes('instagram.com')) {
      return res.status(400).json({ error: 'Valid Instagram URL is required' });
    }

    const folder = await PoolFolder.findById(folderId).populate('poolId');
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const poolId = folder.poolId._id || folder.poolId;
    const safeName = `insta_${Date.now()}`;
    const outPath = path.join(os.tmpdir(), `${safeName}.mp4`);

    const ffmpegBin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const ffmpegAvailable = fs.existsSync(path.join(FFMPEG_DIR, ffmpegBin))
      || fs.existsSync('/usr/bin/ffmpeg')
      || fs.existsSync('/usr/local/bin/ffmpeg');

    const args = [
      '--no-playlist',
      ...YT_DLP_ARGS,
      ...(ffmpegAvailable
        ? [
            '--ffmpeg-location', fs.existsSync(path.join(FFMPEG_DIR, ffmpegBin)) ? FFMPEG_DIR : '/usr/bin',
            '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best',
            '--merge-output-format', 'mp4',
          ]
        : ['-f', 'best[ext=mp4]/best']),
      '-o', outPath,
      url,
    ];

    execFile(YT_DLP, args, { timeout: 120000 }, async (err, stdout, stderr) => {
      if (err) {
        console.error('[FolderDownload] yt-dlp error:', stderr || err.message);
        if (fs.existsSync(outPath)) fs.unlink(outPath, () => {});
        return res.status(500).json({ error: 'Failed to download reel. The reel may be private or unavailable.' });
      }

      if (!fs.existsSync(outPath)) {
        return res.status(500).json({ error: 'Downloaded file not found.' });
      }

      try {
        const fileBuffer = fs.readFileSync(outPath);
        const s3Key = `${poolId}/folders/${folderId}/${safeName}.mp4`;

        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: s3Key,
          Body: fileBuffer,
          ContentType: 'video/mp4',
          ContentLength: fileBuffer.length,
        }));

        fs.unlink(outPath, () => {});

        const s3Url = await getobject(s3Key);
        const reel = await Reel.create({
          poolId,
          folderId,
          s3Key,
          s3Url,
          title: `Instagram Reel - ${new Date().toLocaleDateString()}`,
        });

        await PoolFolder.findByIdAndUpdate(folderId, { $inc: { reelCount: 1 } });
        await Pool.findByIdAndUpdate(poolId, { $inc: { reelCount: 1 } });

        res.status(201).json({ success: true, reel: { ...reel.toObject(), s3Url } });
      } catch (uploadErr) {
        if (fs.existsSync(outPath)) fs.unlink(outPath, () => {});
        console.error('[FolderDownload] Upload error:', uploadErr.message);
        res.status(500).json({ error: 'Failed to upload reel to storage.', details: uploadErr.message });
      }
    });
  } catch (err) {
    console.error('[FolderDownload] Unexpected error:', err.message);
    res.status(500).json({ error: 'Unexpected server error.', details: err.message });
  }
};
