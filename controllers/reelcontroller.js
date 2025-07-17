const busboy = require('busboy');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, getobject, deleteObject } = require('../utils/s3');
const Reel = require('../models/Reel');
const Pool = require('../models/pool');
const User = require('../models/user');
const SharedReels = require('../models/SharedReels');
const UserResponse = require('../models/userResponse');
const userResponse = require('../models/userResponse');
const Campaign = require('../models/campaign'); // Add this import at the top if not present

exports.uploadReels = async (req, res) => {
  //   const clientId = req.user.id
  const bb = busboy({ headers: req.headers });
  const { poolId } = req.params; // Get poolId from URL params
  const reels = [];
  let fileUploadPromises = [];

  // Fetch campaign name using poolId
  let campaignName = 'campaign';
  try {
    const pool = await Pool.findById(poolId);
    if (pool && pool.name) {
      campaignName = pool.name.replace(/\s+/g, '_'); // Replace spaces with underscores
    }
  } catch (err) {
    console.error('Error fetching pool for campaign name:', err);
  }

  // Count existing reels for this pool to determine the next reel number
  let reelCount = 0;
  try {
    reelCount = await Reel.countDocuments({ poolId });
  } catch (err) {
    console.error('Error counting reels for pool:', err);
  }

  let reelNumber = reelCount + 1;

  bb.on('file', (fieldname, file, filename, encoding, mimetype) => {
    const currentReelNumber = reelNumber++; // Assign and increment immediately for each file
    // Buffer the file chunks in memory
    const chunks = [];
    file.on('data', (chunk) => {
      chunks.push(chunk);
    });
    file.on('end', async () => {
      const fileBuffer = Buffer.concat(chunks);
      // Ensure filename is a string
      if (typeof filename !== 'string' || !filename) {
        filename = `${campaignName}_reel${currentReelNumber}.mp4`;
      } else {
        // Replace original filename with campaignName_reel{n}.mp4
        filename = `${campaignName}_reel${currentReelNumber}.mp4`;
      }
      const s3Key = `${poolId}/reels/${filename}`;
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
            title: `${campaignName} Reel ${currentReelNumber}`
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
    res.json({ success: true, reels });
  });

  req.pipe(bb);
};

exports.getReelsByPool = async (req, res) => {
  const { poolId } = req.query;
  if (!poolId) {
    return res.status(400).json({ success: false, error: "poolId is required" });
  }
  try {
    const reels = await Reel.find({ poolId });
    res.json({ success: true, reels });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch reels" });
  }
};

exports.getReelsByPoolId = async (req, res) => {
  const { poolId } = req.params;
  if (!poolId) {
    return res.status(400).json({ success: false, error: "poolId is required" });
  }
  try {
    const reels = await Reel.find({ poolId });
    res.json({ success: true, reels });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch reels" });
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
      return res.status(404).json({ success: false, error: 'Reel not found' });
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
    res.json({ success: true, message: 'Reel deleted successfully' });
  } catch (err) {
    console.error('Error deleting reel:', err);
    res.status(500).json({ success: false, error: 'Failed to delete reel', details: err.message });
  }
};

// Delete multiple reels
exports.deleteMultipleReels = async (req, res) => {
  try {
    const { reelIds } = req.body;
    
    if (!reelIds || !Array.isArray(reelIds) || reelIds.length === 0) {
      return res.status(400).json({ success: false, error: 'reelIds array is required' });
    }
    
    console.log('Deleting multiple reels:', reelIds);
    
    // Find all reels to be deleted
    const reels = await Reel.find({ _id: { $in: reelIds } });
    
    if (reels.length === 0) {
      return res.status(404).json({ success: false, error: 'No reels found to delete' });
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
      success: true,
      message: `${reels.length} reels deleted successfully`,
      deletedCount: reels.length
    });
  } catch (err) {
    console.error('Error deleting multiple reels:', err);
    res.status(500).json({ success: false, error: 'Failed to delete reels', details: err.message });
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
        success: true,
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
      success: true,
      message: `All reels deleted from pool successfully`,
      deletedCount: reels.length
    });
  } catch (err) {
    console.error('Error deleting all reels from pool:', err);
    res.status(500).json({ success: false, error: 'Failed to delete reels from pool', details: err.message });
  }
};

// Assign specified number of reels to each user (sequential with shuffled reels)
exports.assignReelsToUsersWithCount = async (req, res) => {
  const { userIds, reelIds, reelsPerUser, campaignId } = req.body;
  // Validate inputs
  if (!Array.isArray(userIds) || !Array.isArray(reelIds) || !reelsPerUser || reelsPerUser < 1) {
    return res.status(400).json({ 
      success: false,
      error: "userIds and reelIds must be arrays and reelsPerUser must be a positive number." 
    });
  }

  const totalReelsNeeded = userIds.length * reelsPerUser;
  if (reelIds.length < totalReelsNeeded) {
    return res.status(400).json({ 
      success: false,
      error: `Not enough reels. Need ${totalReelsNeeded} reels for ${userIds.length} users with ${reelsPerUser} reels each, but only ${reelIds.length} reels provided.` 
    });
  }

  try {
    // Fetch campaign to get image key
    const Campaign = require('../models/campaign');
    const campaign = await Campaign.findById(campaignId);
    const campaignImageKey = campaign && campaign.image && campaign.image.key ? campaign.image.key : null;

    // Fetch users by googleId
    const users = await User.find({ googleId: { $in: userIds } });
    if (users.length !== userIds.length) {
      return res.status(400).json({ 
        success: false,
        error: "Some users not found. Please check the userIds." 
      });
    }

    // Fetch reels by IDs
    const reels = await Reel.find({ _id: { $in: reelIds } });
    if (reels.length !== reelIds.length) {
      return res.status(400).json({ 
        success: false,
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
          campaignId: campaignId,
          title: reel.title || '',
          campaignImageKey: campaignImageKey
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
        duplicateReels,
        reels: userReels // include full reel info in response
      });
      duplicateReelsByUser[userId] = duplicateReels;
    }

    // Determine if there were any duplicates
    const hasDuplicates = Object.values(duplicateReelsByUser).some(arr => arr.length > 0);
    const responseMessage = hasDuplicates
      ? 'Reel not assigned. Duplicate reels were not allowed.'
      : `Successfully assigned up to ${reelsPerUser} new reels to each of ${userIds.length} users.`;

    res.json({
      success: true,
      message: responseMessage,
      isDuplicate: hasDuplicates,
      assignments,
      duplicateReelsByUser,
      campaignId // include campaignId in the response
    });

  } catch (err) {
    console.error('Error assigning reels to users:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Cleanup script: Remove SharedReels documents with empty reels arrays
exports.cleanupEmptySharedReels = async (req, res) => {
  try {
    const result = await SharedReels.deleteMany({ reels: { $size: 0 } });
    res.json({ success: true, message: 'Cleanup complete', deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

//to store in db
exports.getSharedReelsForUser = async (req, res) => {
  const { userId } = req.params; // userId is googleId
  try {
    const shared = await SharedReels.findOne({ googleId: userId });
    if (!shared || !Array.isArray(shared.reels)) {
      return res.json({ success: true, reels: [] });
    }
    // Generate fresh S3 URLs for each reel and for campaign image
    const reelsWithFreshUrls = await Promise.all(shared.reels.map(async r => ({
      reelId: r.reelId,
      s3Key: r.s3Key,
      s3Url: r.s3Key ? await getobject(r.s3Key) : '',
      campaignId: r.campaignId,
      title: r.title || '',
      campaignImageKey: r.campaignImageKey || '',
      campaignImageUrl: r.campaignImageKey ? await getobject(r.campaignImageKey) : '',
      _id: r._id
    })));
    res.status(200).json({ success: true, reels: reelsWithFreshUrls });
  } catch (err) { 
    res.status(500).json({ error: err.message });
  }
};

// Add or update a user's response URL
exports.addUserResponseUrl = async (req, res) => {
  const { userId } = req.params;
  const { url, campaignId } = req.body;
  if (!userId || !url || !campaignId) {
    return res.status(400).json({ error: 'userId (param) and url, campaignId (body) are required.' });
  }
  try {
    // Find the campaign and get its credits value
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const creditAmount = campaign.credits || 0;

    let userResponse = await UserResponse.findOne({ googleId: userId });
    const responseEntry = {
      urls: url,
      campaignId,
      isTaskCompleted: true,
      views: 0,
      isCreditAccepted: false,
      creditAmount: creditAmount,
      status: 'pending'
    };
    if (!userResponse) {
      userResponse = new UserResponse({ googleId: userId, response: [responseEntry] });
    } else {
      userResponse.response.push(responseEntry);
    }
    await userResponse.save();
    res.json({ success: true, userResponse });
  } catch (err) {
    console.error('Error saving user response:', err);
    res.status(500).json({ error: 'Failed to save user response', details: err.message });
  }
};

exports.getAddUserResponseUrl = async (req, res) =>{
  const {userId} = req.params;
  try{
    const responsed = await userResponse.findOne({googleId: userId});
    if (!responsed || !Array.isArray(responsed.response)) {
      return res.json({ success: true, response: [] });
    }
    res.json({ success: true, response: responsed.response });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};