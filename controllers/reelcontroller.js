const busboy = require('busboy');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, getobject, deleteObject } = require('../utils/s3');
const Reel = require('../models/Reel');
const Pool = require('../models/pool');

exports.uploadReels = (req, res) => {
//   const clientId = req.user.id
  const bb = busboy({ headers: req.headers });
  const { poolId } = req.params; // Get poolId from URL params
  const reels = [];
  let fileUploadPromises = [];

  bb.on('file', (fieldname, file, filename, encoding, mimetype) => {
    // Buffer the file chunks in memory
    const chunks = [];
    file.on('data', (chunk) => {
      chunks.push(chunk);
    });
    file.on('end', async () => {
      const fileBuffer = Buffer.concat(chunks);
      // Ensure filename is a string
      if (typeof filename !== 'string' || !filename) {
        filename = `video-${Date.now()}.mp4`;
      }
      const s3Key = `${poolId}/reels/${Date.now()}-${filename}`;
      const uploadParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: mimetype || 'video/mp4',
        ContentLength: fileBuffer.length,
      };

      const uploadPromise = s3Client.send(new PutObjectCommand(uploadParams))
        .then(async () => {
          // Generate pre-signed GET URL for access
          const s3Url = await getobject(s3Key);
          // Save to DB
          const reelDoc = await Reel.create({
            poolId,
            s3Key,
            s3Url,
          });
          reels.push(reelDoc);
        })
        .catch(err => {
          console.error('Error uploading file:', err);
        });

      fileUploadPromises.push(uploadPromise);
    });
  });

  bb.on('finish', async () => {
    await Promise.all(fileUploadPromises);
    // Optionally update reelCount in Pool
    if (poolId) {
      await Pool.findByIdAndUpdate(
        poolId,
        { $inc: { reelCount: reels.length } }
      );
    }
    res.json({ reels });
  });

  req.pipe(bb);
};

exports.getReelsByPool = async (req, res) => {
  const { poolId } = req.query;
  if (!poolId) {
    return res.status(400).json({ error: "poolId is required" });
  }
  try {
    const reels = await Reel.find({ poolId });
    res.json({ reels });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch reels" });
  }
};

exports.getReelsByPoolId = async (req, res) => {
  const { poolId } = req.params;
  if (!poolId) {
    return res.status(400).json({ error: "poolId is required" });
  }
  try {
    const reels = await Reel.find({ poolId });
    res.json({ reels });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch reels" });
  }
};

// Delete a single reel
exports.deleteReel = async (req, res) => {
  try {
    const { reelId } = req.params;
    
    console.log('Deleting reel:', reelId);
    
    // Find the reel first
    const reel = await Reel.findById(reelId);
    if (!reel) {
      return res.status(404).json({ error: 'Reel not found' });
    }
    
    // Delete from S3
    if (reel.s3Key) {
      try {
        await deleteObject(reel.s3Key);
        console.log('Reel deleted from S3:', reel.s3Key);
      } catch (s3Error) {
        console.error('Error deleting from S3:', s3Error);
        // Continue with database deletion even if S3 deletion fails
      }
    }
    
    // Delete from database
    await Reel.findByIdAndDelete(reelId);
    
    // Update pool reel count
    if (reel.poolId) {
      await Pool.findByIdAndUpdate(
        reel.poolId,
        { $inc: { reelCount: -1 } }
      );
    }
    
    console.log('Reel deleted successfully:', reelId);
    res.json({ message: 'Reel deleted successfully' });
  } catch (err) {
    console.error('Error deleting reel:', err);
    res.status(500).json({ error: 'Failed to delete reel', details: err.message });
  }
};

// Delete multiple reels
exports.deleteMultipleReels = async (req, res) => {
  try {
    const { reelIds } = req.body;
    
    if (!reelIds || !Array.isArray(reelIds) || reelIds.length === 0) {
      return res.status(400).json({ error: 'reelIds array is required' });
    }
    
    console.log('Deleting multiple reels:', reelIds);
    
    // Find all reels to be deleted
    const reels = await Reel.find({ _id: { $in: reelIds } });
    
    if (reels.length === 0) {
      return res.status(404).json({ error: 'No reels found to delete' });
    }
    
    // Group reels by poolId for count updates
    const poolUpdates = {};
    
    // Delete from S3 and prepare pool updates
    const deletePromises = reels.map(async (reel) => {
      if (reel.s3Key) {
        try {
          await deleteObject(reel.s3Key);
          console.log('Reel deleted from S3:', reel.s3Key);
        } catch (s3Error) {
          console.error('Error deleting from S3:', s3Error);
        }
      }
      
      // Track pool updates
      if (reel.poolId) {
        poolUpdates[reel.poolId] = (poolUpdates[reel.poolId] || 0) + 1;
      }
    });
    
    await Promise.all(deletePromises);
    
    // Delete from database
    await Reel.deleteMany({ _id: { $in: reelIds } });
    
    // Update pool reel counts
    const poolUpdatePromises = Object.entries(poolUpdates).map(([poolId, count]) => 
      Pool.findByIdAndUpdate(poolId, { $inc: { reelCount: -count } })
    );
    
    await Promise.all(poolUpdatePromises);
    
    console.log('Multiple reels deleted successfully:', reelIds.length);
    res.json({ 
      message: `${reels.length} reels deleted successfully`,
      deletedCount: reels.length
    });
  } catch (err) {
    console.error('Error deleting multiple reels:', err);
    res.status(500).json({ error: 'Failed to delete reels', details: err.message });
  }
};

// Delete all reels from a pool
exports.deleteAllReelsFromPool = async (req, res) => {
  try {
    const { poolId } = req.params;
    
    console.log('Deleting all reels from pool:', poolId);
    
    // Find all reels in the pool
    const reels = await Reel.find({ poolId });
    
    if (reels.length === 0) {
      return res.json({ 
        message: 'No reels found in pool',
        deletedCount: 0
      });
    }
    
    // Delete from S3
    const s3DeletePromises = reels.map(async (reel) => {
      if (reel.s3Key) {
        try {
          await deleteObject(reel.s3Key);
          console.log('Reel deleted from S3:', reel.s3Key);
        } catch (s3Error) {
          console.error('Error deleting from S3:', s3Error);
        }
      }
    });
    
    await Promise.all(s3DeletePromises);
    
    // Delete from database
    await Reel.deleteMany({ poolId });
    
    // Reset pool reel count
    await Pool.findByIdAndUpdate(poolId, { reelCount: 0 });
    
    console.log('All reels deleted from pool successfully:', reels.length);
    res.json({ 
      message: `All reels deleted from pool successfully`,
      deletedCount: reels.length
    });
  } catch (err) {
    console.error('Error deleting all reels from pool:', err);
    res.status(500).json({ error: 'Failed to delete reels from pool', details: err.message });
  }
};