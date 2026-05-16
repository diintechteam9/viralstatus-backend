const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const PoolFolder = require('../models/PoolFolder');
const Reel = require('../models/Reel');
const Pool = require('../models/pool');
const { getobject } = require('../utils/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../utils/r2');

// ── RapidAPI fetch + download helpers (shared) ────────────────────────────────
function fetchFromRapidAPI(reelUrl) {
  return new Promise((resolve, reject) => {
    const encoded = encodeURIComponent(reelUrl);
    const options = {
      method: 'GET',
      hostname: 'instagram-reels-downloader-api.p.rapidapi.com',
      path: `/download?url=${encoded}`,
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': 'instagram-reels-downloader-api.p.rapidapi.com',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse API response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const get = (urlStr) => {
      const mod = urlStr.startsWith('https') ? require('https') : require('http');
      mod.get(urlStr, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return get(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error(`Download failed: ${res.statusCode}`));
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

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

    const result = await fetchFromRapidAPI(url);
    if (!result.success || result.data?.error) {
      return res.status(403).json({ error: 'Reel unavailable or private.' });
    }

    const videoMedia = result.data?.medias?.find(m => m.type === 'video');
    if (!videoMedia?.url) return res.status(404).json({ error: 'No video found in this reel.' });

    const safeName = `insta_${Date.now()}`;
    const outPath = path.join(os.tmpdir(), `${safeName}.mp4`);
    await downloadFile(videoMedia.url, outPath);

    if (!fs.existsSync(outPath)) return res.status(500).json({ error: 'Downloaded file not found.' });

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
      title: result.data.title || `Instagram Reel - ${new Date().toLocaleDateString()}`,
    });

    await Pool.findByIdAndUpdate(poolId, { $inc: { reelCount: 1 } });
    res.status(201).json({ success: true, reel: { ...reel.toObject(), s3Url } });
  } catch (err) {
    console.error('[PoolDownload] Error:', err.message);
    res.status(500).json({ error: 'Failed to save reel.', details: err.message });
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

    const result = await fetchFromRapidAPI(url);
    if (!result.success || result.data?.error) {
      return res.status(403).json({ error: 'Reel unavailable or private.' });
    }

    const videoMedia = result.data?.medias?.find(m => m.type === 'video');
    if (!videoMedia?.url) return res.status(404).json({ error: 'No video found in this reel.' });

    const safeName = `insta_${Date.now()}`;
    const outPath = path.join(os.tmpdir(), `${safeName}.mp4`);
    await downloadFile(videoMedia.url, outPath);

    if (!fs.existsSync(outPath)) return res.status(500).json({ error: 'Downloaded file not found.' });

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
      title: result.data.title || `Instagram Reel - ${new Date().toLocaleDateString()}`,
    });

    await PoolFolder.findByIdAndUpdate(folderId, { $inc: { reelCount: 1 } });
    await Pool.findByIdAndUpdate(poolId, { $inc: { reelCount: 1 } });
    res.status(201).json({ success: true, reel: { ...reel.toObject(), s3Url } });
  } catch (err) {
    console.error('[FolderDownload] Error:', err.message);
    res.status(500).json({ error: 'Failed to save reel.', details: err.message });
  }
};
