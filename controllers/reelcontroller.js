const busboy = require('busboy');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, getobject, deleteObject } = require('../utils/s3');
const Reel = require('../models/Reel');
const Pool = require('../models/pool');
const User = require('../models/user');
const SharedReels = require('../models/SharedReels');

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


// Assign specified number of reels to each user (sequential with shuffled reels)
exports.assignReelsToUsersWithCount = async (req, res) => {
  const { userIds, reelIds, reelsPerUser } = req.body;
  
  // Validate inputs
  if (!Array.isArray(userIds) || !Array.isArray(reelIds) || !reelsPerUser || reelsPerUser < 1) {
    return res.status(400).json({ 
      error: "userIds and reelIds must be arrays, and reelsPerUser must be a positive number." 
    });
  }

  const totalReelsNeeded = userIds.length * reelsPerUser;
  if (reelIds.length < totalReelsNeeded) {
    return res.status(400).json({ 
      error: `Not enough reels. Need ${totalReelsNeeded} reels for ${userIds.length} users with ${reelsPerUser} reels each, but only ${reelIds.length} reels provided.` 
    });
  }

  try {
    // Fetch users by googleId
    const users = await User.find({ googleId: { $in: userIds } });
    if (users.length !== userIds.length) {
      return res.status(400).json({ 
        error: "Some users not found. Please check the userIds." 
      });
    }

    // Fetch reels by IDs
    const reels = await Reel.find({ _id: { $in: reelIds } });
    if (reels.length !== reelIds.length) {
      return res.status(400).json({ 
        error: "Some reels not found. Please check the reelIds." 
      });
    }

    // Shuffle the reels array for fair distribution
    const shuffledReels = [...reels].sort(() => Math.random() - 0.5);
    
    // Create assignments
    const assignments = [];
    let reelIndex = 0;
    const duplicateReelsByUser = {};

    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i];
      const userReels = [];
      const duplicateReels = [];

      // Fetch user's existing SharedReels document
      const shared = await SharedReels.findOne({ googleId: userId });
      const existingReelIds = shared ? shared.reels.map(r => r.reelId) : [];

      // Assign reelsPerUser reels to this user
      let assignedCount = 0;
      while (assignedCount < reelsPerUser && reelIndex < shuffledReels.length) {
        const reel = shuffledReels[reelIndex];
        reelIndex++;
        if (existingReelIds.includes(reel._id.toString())) {
          duplicateReels.push(reel._id.toString());
          continue;
        }
        userReels.push({
          reelId: reel._id,
          s3Key: reel.s3Key,
          s3Url: reel.s3Url,
          isTaskCompleted: false
        });
        assignedCount++;
      }
      // Upsert: add all new reels to the user's document, or create if not exists
      if (userReels.length > 0) {
        await SharedReels.findOneAndUpdate(
          { googleId: userId },
          { $push: { reels: { $each: userReels } } },
          { upsert: true, new: true }
        );
      }
      assignments.push({
        userId,
        assignedReels: userReels.map(r => r.reelId),
        duplicateReels
      });
      duplicateReelsByUser[userId] = duplicateReels;
    }

    // Determine if there were any duplicates
    const hasDuplicates = Object.values(duplicateReelsByUser).some(arr => arr.length > 0);
    const responseMessage = hasDuplicates
      ? 'Reel not assigned. Duplicate reels were not allowed.'
      : `Successfully assigned up to ${reelsPerUser} new reels to each of ${userIds.length} users.`;

    res.json({
      message: responseMessage,
      isDuplicate: hasDuplicates,
      assignments,
      duplicateReelsByUser
    });

  } catch (err) {
    console.error('Error assigning reels to users:', err);
    res.status(500).json({ error: err.message });
  }
};

// Cleanup script: Remove SharedReels documents with empty reels arrays
exports.cleanupEmptySharedReels = async (req, res) => {
  try {
    const result = await SharedReels.deleteMany({ reels: { $size: 0 } });
    res.json({ message: 'Cleanup complete', deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

//to store in db
exports.getSharedReelsForUser = async (req, res) => {
  const { userId } = req.params; // userId is googleId
  try {
    const shared = await SharedReels.findOne({ googleId: userId });
    if (!shared || !Array.isArray(shared.reels)) {
      return res.json([]);
    }
    res.json(shared.reels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};