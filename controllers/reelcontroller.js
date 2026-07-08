const busboy = require('busboy');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, getobject, deleteObject, putobject } = require('../utils/r2');
const mongoose = require('mongoose');
const axios = require('axios');
const Reel = require('../models/Reel');
const Pool = require('../models/pool');
const User = require('../models/user');
const SharedReels = require('../models/SharedReels');
const UserResponse = require('../models/userResponse');
const userResponse = require('../models/userResponse');
const Campaign = require('../models/campaign');
const RegisteredCampaign = require('../models/RegisteredCampaign');
const CreditWallet = require('../models/CreditWallet');
const TransactionHistory = require('../models/TransactionHistory');
const getYoutubeStats = require('../utils/getYoutubeStats');
const { getPostStats, detectPlatform, extractYoutubeId } = require('../utils/socialPostStats');
const telegramAlerts = require('../utils/telegramAlerts');
const { resolveUserProfiles, resolveOneUserProfile } = require('../utils/resolveUserProfiles');
const {
  acceptUserTask,
  cancelUserTask,
  syncSharedReelSubmission,
  buildTimerPayload,
  normalizeReelAcceptState,
} = require('../services/userTaskService');
const UGCSubmission = require('../models/UGCSubmission');
const CampaignTask = require('../models/CampaignTask');

// ─── Fast Multi Upload: Step 1 — Get batch presigned PUT URLs ───────────────
exports.getPresignedUrls = async (req, res) => {
  try {
    const { poolId } = req.params;
    const { files } = req.body;

    if (!poolId || !Array.isArray(files) || files.length === 0)
      return res.status(400).json({ success: false, error: 'poolId and files array required' });

    // Fetch pool + reelCount in parallel
    const [pool, reelCount] = await Promise.all([
      Pool.findById(poolId),
      Reel.countDocuments({ poolId }),
    ]);
    if (!pool) return res.status(404).json({ success: false, error: 'Pool not found' });

    const campaignName = (pool.name || 'reel').replace(/\s+/g, '_');
    const ts = Date.now();

    // Generate all presigned URLs in parallel
    const results = await Promise.all(
      files.map((file, i) => {
        const ext = (file.name || 'video.mp4').split('.').pop().toLowerCase() || 'mp4';
        const s3Key = `${poolId}/reels/${campaignName}_${ts}_${i}.${ext}`;
        return putobject(s3Key, file.type || 'video/mp4').then((uploadUrl) => ({
          s3Key, uploadUrl, originalName: file.name, index: i,
        }));
      })
    );

    res.json({ success: true, files: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Fast Multi Upload: Step 2 — Save metadata after direct R2 upload ────────
exports.saveReelMetadata = async (req, res) => {
  try {
    const { poolId } = req.params;
    const { reels } = req.body;

    if (!poolId || !Array.isArray(reels) || reels.length === 0)
      return res.status(400).json({ success: false, error: 'poolId and reels array required' });

    // Filter out already existing s3Keys to prevent duplicates
    const existingKeys = await Reel.find({ s3Key: { $in: reels.map(r => r.s3Key) } }).select('s3Key');
    const existingKeySet = new Set(existingKeys.map(r => r.s3Key));
    const newReels = reels.filter(r => !existingKeySet.has(r.s3Key));

    if (newReels.length === 0)
      return res.json({ success: true, reels: [], count: 0, message: 'All reels already uploaded' });

    // Generate all signed GET URLs in parallel
    const urlMap = await Promise.all(newReels.map((r) => getobject(r.s3Key)));

    // Bulk insert all reels at once
    const docs = newReels.map((r, i) => ({
      poolId,
      s3Key: r.s3Key,
      s3Url: urlMap[i],
      title: r.title || '',
      description: r.description || '',
    }));
    const savedReels = await Reel.insertMany(docs, { ordered: false });

    // Single atomic increment
    await Pool.findByIdAndUpdate(poolId, { $inc: { reelCount: savedReels.length } });

    res.json({ success: true, reels: savedReels, count: savedReels.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────

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
      const uploadPromise = s3Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: mimetype || 'video/mp4',
        ContentLength: fileBuffer.length,
      }))
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


exports.getReelsByPoolId = async (req, res) => {
  const { poolId } = req.params;
  if (!poolId) {
    return res.status(400).json({ success: false, error: "poolId is required" });
  }
  try {
    const reels = await Reel.find({ poolId });
    
    // Generate fresh S3 URLs for each reel to prevent expiration
    const reelsWithFreshUrls = await Promise.all(
      reels.map(async (reel) => {
        try {
          // Generate a fresh pre-signed URL for each reel
          const freshUrl = await getobject(reel.s3Key);
          return {
            ...reel.toObject(),
            s3Url: freshUrl
          };
        } catch (urlError) {
          console.error(`Error generating fresh URL for reel ${reel._id}:`, urlError);
          // Return reel with original URL if fresh URL generation fails
          return reel.toObject();
        }
      })
    );
    
    res.json({ success: true, reels: reelsWithFreshUrls });
  } catch (err) {
    console.error('Error fetching reels by pool ID:', err);
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

// Assign reels to users — round-robin through selected pool (same reel can go to multiple users)
exports.assignReelsToUsersWithCount = async (req, res) => {
  let { userIds, reelIds, reelsPerUser, campaignId, assignmentScope } = req.body;
  // Validate inputs
  if (!Array.isArray(reelIds) || !reelsPerUser || reelsPerUser < 1) {
    return res.status(400).json({ 
      success: false,
      error: "reelIds must be an array and reelsPerUser must be a positive number." 
    });
  }

  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    // Public campaign — auto-assign to all registered users when no userIds provided
    if (!Array.isArray(userIds) || userIds.length === 0) {
      if (campaign.campaignType === 'public') {
        const MobileUser = require('../models/MobileUser');
        const allUsers = await MobileUser.find({ googleId: { $exists: true, $ne: null, $ne: '' } })
          .select('googleId').lean();
        userIds = allUsers.map(u => u.googleId).filter(Boolean);
      }
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No users to assign. For private campaigns, select participants first.',
      });
    }

    // Validate all reelIds are valid MongoDB ObjectIds
    const invalidReelIds = reelIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidReelIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid reel IDs provided: ${invalidReelIds.join(', ')}. Each reelId must be a valid MongoDB ObjectId.`
      });
    }

    if (!reelIds.length) {
      return res.status(400).json({
        success: false,
        error: 'Select at least one reel to assign.',
      });
    }

    const isPublicCampaign = campaign.campaignType === 'public';
    const taskCampaignType =
      assignmentScope === 'public' || assignmentScope === 'private'
        ? assignmentScope
        : isPublicCampaign
          ? 'public'
          : 'private';

    const campaignImageKey = campaign?.image?.key || null;

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
    
    // Create assignments — round-robin through shuffledReels (reels can be reused across users)
    const assignments = [];
    let reelIndex = 0;
    const duplicateReelsByUser = {};

    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i]; // googleId
      const userReels = [];
      const duplicateReels = [];

      // Fetch user's existing SharedReels document
      const shared = await SharedReels.findOne({ googleId: userId });
      const existingReelIdsForCampaign = shared
        ? shared.reels
            .filter((r) => String(r.campaignId) === String(campaignId))
            .map((r) => r.reelId?.toString())
        : [];
      const campaignName = campaign.campaignName;
      const campaignCredits = campaign.credits;

      // Assign reelsPerUser reels to this user (cycle pool when fewer reels than users)
      let assignedCount = 0;
      let attempts = 0;
      const maxAttempts = shuffledReels.length * reelsPerUser + shuffledReels.length;
      while (assignedCount < reelsPerUser && attempts < maxAttempts) {
        const reel = shuffledReels[reelIndex % shuffledReels.length];
        reelIndex++;
        attempts++;
        if (existingReelIdsForCampaign.includes(reel._id.toString())) {
          duplicateReels.push(reel._id.toString());
          continue;
        }
        const autoAccept = !!campaign.autoApproval;
        const now = new Date();
        userReels.push({
          reelId: reel._id,
          s3Key: reel.s3Key,
          s3Url: reel.s3Url,
          campaignId: campaignId,
          campaignName: campaignName,
          credits: campaignCredits,
          title: reel.title || '',
          campaignImageKey: campaignImageKey,
          isTaskComplete: false,
          isTaskAccepted: autoAccept,
          TaskStatus: autoAccept ? 'accepted' : 'pending',
          acceptedAt: autoAccept ? now : null,
          campaignType: taskCampaignType,
          contentCategory: 'reels',
          campaignTaskId: '',
          createdAt: now,
        });
        assignedCount++;
      }

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
        reels: userReels
      });
      duplicateReelsByUser[userId] = duplicateReels;
    }

    const usersWithTasks = assignments.filter((a) => (a.reels?.length || 0) > 0).length;
    const totalAssigned = assignments.reduce((sum, a) => sum + (a.reels?.length || 0), 0);
    const skippedDuplicates = Object.values(duplicateReelsByUser).reduce((sum, arr) => sum + arr.length, 0);

    let responseMessage;
    if (totalAssigned === 0) {
      responseMessage = skippedDuplicates
        ? 'No new tasks assigned — selected reel(s) were already assigned to these users for this campaign.'
        : 'No tasks were assigned.';
    } else if (isPublicCampaign) {
      responseMessage = `Assigned ${totalAssigned} task(s) to ${usersWithTasks} of ${userIds.length} users using ${reelIds.length} reel(s) (round-robin).`;
    } else {
      responseMessage = `Successfully assigned ${totalAssigned} task(s) to ${usersWithTasks} user(s).`;
    }
    if (skippedDuplicates > 0 && totalAssigned > 0) {
      responseMessage += ` (${skippedDuplicates} duplicate assignment(s) skipped.)`;
    }

    const hasDuplicates = skippedDuplicates > 0;

    if (totalAssigned === 0) {
      return res.status(400).json({
        success: false,
        message: responseMessage,
        isDuplicate: hasDuplicates,
        assignments,
        duplicateReelsByUser,
        campaignId,
      });
    }

    res.json({
      success: true,
      message: responseMessage,
      isDuplicate: hasDuplicates,
      assignments,
      duplicateReelsByUser,
      campaignId
    });
    if (!hasDuplicates && assignments.some((a) => (a.reels?.length || 0) > 0)) {
      const profiles = await resolveUserProfiles(userIds);
      const enriched = assignments
        .filter((a) => a.reels?.length > 0)
        .map((a) => ({ ...a, profile: profiles[a.userId] }));
      telegramAlerts
        .alertTasksAssigned({
          campaign: campaign.toObject ? campaign.toObject() : campaign,
          assignments: enriched,
          reelsPerUser,
          autoApproval: !!campaign.autoApproval,
        })
        .catch((err) => console.error('[Telegram] task assign alert:', err.message));
    }

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

// Resolve whether a shared reel is public or private for the user-facing Task tabs
function resolveReelCampaignType(reel, campaign, userId, registeredCampaignIds, registeredCampaigns = []) {
  // Public bulk-assignment flag always wins — must show in Public tab
  if (reel.campaignType === 'public') {
    return 'public';
  }

  const cid = String(reel.campaignId || '');
  const userJoined =
    registeredCampaignIds.has(cid) ||
    (Array.isArray(campaign?.userIds) && campaign.userIds.includes(userId));
  const campaignIsPrivate = !campaign || campaign.campaignType !== 'public';
  const joinedEntry = registeredCampaigns.find(
    (entry) => String(entry.campaign?._id || entry.campaign?.id || '') === cid
  );
  const joinedAsPrivate = joinedEntry && joinedEntry.campaign?.campaignType !== 'public';

  if (reel.campaignType === 'private') {
    return 'private';
  }

  // Joined private campaign → Private tab
  if ((userJoined && campaignIsPrivate) || joinedAsPrivate) {
    return 'private';
  }

  return campaign?.campaignType === 'public' ? 'public' : 'private';
}

//to store in db
exports.getSharedReelsForUser = async (req, res) => {
  const { userId } = req.params;
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  try {
    const CampaignTask = require('../models/CampaignTask');
    const now = new Date();

    const shared = await SharedReels.findOne({ googleId: userId });
    const sharedReels = shared?.reels || [];

    // ── Build a set of campaignTaskIds already in user's SharedReels ──
    const userReelTaskIdSet = new Set(
      sharedReels.map(r => r.campaignTaskId || r.reelId).filter(Boolean).map(String)
    );

    // ── Fetch all active public tasks not yet in user's SharedReels ──
    const explicitPublicTasks = await CampaignTask.find({ visibility: 'public', status: 'active' }).lean();
    const publicCampaigns = await Campaign.find({
      campaignType: 'public', status: 'Active',
      $or: [{ endDate: null }, { endDate: { $gt: now } }],
    }).select('_id').lean();
    const publicCampaignIds = publicCampaigns.map(c => String(c._id));
    const publicCampaignTasks = publicCampaignIds.length
      ? await CampaignTask.find({ campaignId: { $in: publicCampaignIds }, status: 'active', visibility: { $ne: 'public' } }).lean()
      : [];

    // Deduplicate public tasks
    const publicTaskMap = new Map();
    for (const t of [...explicitPublicTasks, ...publicCampaignTasks]) publicTaskMap.set(String(t._id), t);

    // Build virtual reel entries for public tasks not yet accepted by user
    const virtualPublicReels = [];
    for (const t of publicTaskMap.values()) {
      if (t.deadline && new Date(t.deadline) < now) continue; // skip expired
      if (userReelTaskIdSet.has(String(t._id))) continue;     // already in SharedReels
      virtualPublicReels.push({
        _isVirtual: true,
        reelId: String(t._id),
        campaignTaskId: String(t._id),
        campaignId: t.campaignId,
        title: t.title,
        contentCategory: t.contentCategory || 'post',
        credits: t.credits,
        s3Key: '',
        campaignType: 'public',
        TaskStatus: 'assigned',
        isTaskAccepted: false,
        isTaskComplete: false,
        submissionStatus: 'none',
        acceptedAt: null,
        cancelledAt: null,
        cancellationReason: '',
        penaltyApplied: false,
        creditsPenalized: 0,
        cancelCount: 0,
        createdAt: t.createdAt,
        // task fields for enrichment
        _taskDoc: t,
      });
    }

    const regDoc = await RegisteredCampaign.findOne({ userId }).lean();
    const registeredCampaigns = regDoc?.registeredCampaigns || [];
    const registeredCampaignIds = new Set(
      registeredCampaigns
        .map((entry) => String(entry.campaign?._id || entry.campaign?.id || ''))
        .filter(Boolean)
    );

    // ── Merge: SharedReels (private + already-accepted public) + virtual public ──
    const allCampaignIds = [...new Set([
      ...sharedReels.map(r => r.campaignId),
      ...virtualPublicReels.map(r => r.campaignId),
    ].filter(Boolean))];

    const campaigns = await Campaign.find({ _id: { $in: allCampaignIds } })
      .select('_id campaignName brandName description clientId campaignType supportedTaskTypes tNc goal views cutoff credits endDate startDate status penaltyThresholdMinutes cancellationPenalty allowCancellation autoApproval image brandImage tags location userIds')
      .lean();
    const campaignMap = new Map(campaigns.map(c => [String(c._id), c]));

    const expiredIds = new Set(
      campaigns.filter(c => c.endDate && new Date(c.endDate) < now).map(c => String(c._id))
    );

    // Filter SharedReels: remove expired, rejected
    const filteredSharedReels = sharedReels.filter(r =>
      !expiredIds.has(String(r.campaignId)) &&
      r.TaskStatus !== 'rejected'
    );

    // Filter virtual public reels: remove expired campaigns
    const filteredVirtualReels = virtualPublicReels.filter(r =>
      !expiredIds.has(String(r.campaignId))
    );

    // Combine: shared reels first, then unaccepted public tasks at end
    const allReels = [...filteredSharedReels, ...filteredVirtualReels];
    const total      = allReels.length;
    const totalPages = Math.ceil(total / limit);
    const reelsToReturn = allReels.slice(skip, skip + limit);

    // Fetch all CampaignTask docs needed in one query
    const campaignTaskIds = [...new Set(
      reelsToReturn.map(r => r.campaignTaskId).filter(id => id && mongoose.Types.ObjectId.isValid(id))
    )];
    const campaignTasks = campaignTaskIds.length
      ? await CampaignTask.find({ _id: { $in: campaignTaskIds } }).lean()
      : [];
    const campaignTaskMap = new Map(campaignTasks.map(t => [String(t._id), t]));

    const userRespDoc = await UserResponse.findOne({ googleId: userId });
    const userResponses = userRespDoc && Array.isArray(userRespDoc.response) ? userRespDoc.response : [];

    // Fetch all UGC submissions
    const ugcTaskIds = reelsToReturn
      .filter(r => r.contentCategory === 'ugc' && r.campaignTaskId)
      .map(r => String(r.campaignTaskId))
      .filter(Boolean);
    const ugcSubmissions = ugcTaskIds.length
      ? await UGCSubmission.find({ userId: String(userId), campaignTaskId: { $in: ugcTaskIds } }).lean()
      : [];
    const ugcSubmissionMap = new Map(ugcSubmissions.map(s => [String(s.campaignTaskId), s]));

    let legacyFixed = false;

    const reelsWithFreshUrls = await Promise.all(reelsToReturn.map(async (r) => {
      const campaign = campaignMap.get(String(r.campaignId));
      // For virtual public reels, use the embedded _taskDoc; else look up campaignTaskMap
      const campaignTask = r._taskDoc || (r.campaignTaskId ? campaignTaskMap.get(String(r.campaignTaskId)) : null);
      const isPublicTask = r.campaignType === 'public';

      if (!r._isVirtual) {
        const before = JSON.stringify({ a: r.isTaskAccepted, t: r.TaskStatus, at: r.acceptedAt });
        normalizeReelAcceptState(r);
        const after = JSON.stringify({ a: r.isTaskAccepted, t: r.TaskStatus, at: r.acceptedAt });
        if (before !== after) legacyFixed = true;
      }

      const userRespEntry = userResponses.find(ur =>
        String(ur.reelId) === String(r.reelId) ||
        String(ur.reelId) === String(r._id) ||
        String(ur.reelId) === String(r.campaignTaskId) ||
        (String(ur.campaignId) === String(r.campaignId) && String(ur.reelId) === String(r.reelId))
      );
      const timer = buildTimerPayload(r, campaign);

      // contentCategory must be defined before ugcSub check
      const contentCategory = r.contentCategory || campaignTask?.contentCategory || 'reels';

      // For UGC tasks, check UGCSubmission scoped to this specific campaignTaskId
      const ugcSub = (r.contentCategory === 'ugc' || contentCategory === 'ugc')
        ? ugcSubmissionMap.get(String(r.campaignTaskId))
        : null;
      const hasUgcSubmission = !!ugcSub;

      const isUnderReview =
        r.submissionStatus === 'pending_review' ||
        (ugcSub && ugcSub.status === 'pending') ||
        (userRespEntry && userRespEntry.status === 'pending');

      const allowCancellation = !isUnderReview && timer.allowCancellation !== false;

      // Fresh campaign image URL
      let campaignImageUrl = '';
      const imgKey = r.campaignImageKey || campaign?.image?.key || '';
      if (imgKey) {
        try { campaignImageUrl = await getobject(imgKey); } catch (_) {}
      }

      // Fresh brand image URL
      let brandImageUrl = '';
      if (campaign?.brandImage?.key) {
        try { brandImageUrl = await getobject(campaign.brandImage.key); } catch (_) {}
      }

      // Fresh reel media URL (only for reel-type tasks)
      let s3Url = '';
      if (r.s3Key) {
        try { s3Url = await getobject(r.s3Key); } catch (_) {}
      }

      // proofRequired: from CampaignTask if available, else derive from contentCategory
      const proofRequired = (() => {
        const cat = contentCategory;
        if (cat === 'ugc') return 'video';
        if (['app_review', 'gmb_review'].includes(cat)) return 'screenshot';
        if (['reels', 'post'].includes(cat)) return 'url';
        return campaignTask?.proofRequired || 'none';
      })();

      const taskDetails = campaignTask ? {
        instructions: campaignTask.description || '',
        targetUrl: campaignTask.targetUrl || '',
        targetCount: campaignTask.targetCount || 0,
        appName: campaignTask.appName || '',
        businessName: campaignTask.businessName || '',
        minRating: campaignTask.minRating || '',
        script: campaignTask.script || '',
        referenceVideoUrl: campaignTask.referenceVideoUrl || '',
      } : {
        instructions: r.description || campaign?.description || '',
        targetUrl: r.targetUrl || campaign?.goal || '',
        targetCount: r.targetCount || campaign?.cutoff || 0,
        appName: r.appName || '',
        businessName: r.businessName || '',
        minRating: r.minRating || '',
        script: r.script || '',
        referenceVideoUrl: r.referenceVideoUrl || '',
      };

      // taskType for virtual public reels
      const resolvedTaskType = (() => {
        const raw = campaignTask?.taskType || contentCategory;
        if (raw === 'upload_reel' || raw === 'ugc') return 'Upload Video';
        return raw;
      })();
      const resolvedPlatform = campaignTask?.platform || campaign?.supportedTaskTypes?.[0] || contentCategory;

      return {
        // ─── Identity ────────────────────────────────────────────────
        _id: r._id || campaignTask?._id,
        reelId: r.reelId,
        campaignTaskId: r.campaignTaskId || '',
        campaignId: r.campaignId,

        // ─── Task Content ────────────────────────────────────────────
        title: r.title || campaignTask?.title || '',
        contentCategory,
        taskType: resolvedTaskType,
        platform: resolvedPlatform,
        proofRequired,
        isPublicTask,
        credits: r.credits || campaign?.credits || 0,
        instructions: taskDetails.instructions,
        targetUrl: taskDetails.targetUrl,
        targetCount: taskDetails.targetCount,
        appName: taskDetails.appName,
        businessName: taskDetails.businessName,
        minRating: taskDetails.minRating,
        script: taskDetails.script,
        referenceVideoUrl: taskDetails.referenceVideoUrl,
        targetViews: campaignTask?.targetViews || r.targetViews || 0,
        targetLikes: campaignTask?.targetLikes || r.targetLikes || 0,
        targetComments: campaignTask?.targetComments || r.targetComments || 0,
        currentViews: r.currentViews || 0,
        currentLikes: r.currentLikes || 0,
        currentComments: r.currentComments || 0,

        // ─── Task Status ─────────────────────────────────────────────
        TaskStatus: r.TaskStatus || 'assigned',
        submissionStatus: r.submissionStatus || 'none',
        isTaskAccepted: !!r.isTaskAccepted,
        isTaskComplete: !!r.isTaskComplete,
        alreadyCompleted: !!r.isTaskComplete,
        alreadySubmitted: hasUgcSubmission || !!userRespEntry,
        canEdit: !!isUnderReview,
        isUnderReview: !!isUnderReview,
        campaignType: isPublicTask ? 'public' : resolveReelCampaignType(r, campaign, userId, registeredCampaignIds, registeredCampaigns),

        // ─── Timestamps ──────────────────────────────────────────────
        acceptedAt: r.acceptedAt || null,
        cancelledAt: r.cancelledAt || null,
        cancellationReason: r.cancellationReason || '',
        createdAt: r.createdAt,
        updatedAt: r.updatedAt || r.createdAt,

        // ─── Timer & Penalty ─────────────────────────────────────────
        timerExpired: timer.timerExpired,
        penaltyZone: timer.penaltyZone,
        safeToCancel: isUnderReview ? false : timer.safeToCancel,
        remainingMs: timer.remainingMs ?? 0,
        allowCancellation,
        penaltyApplied: !!r.penaltyApplied,
        creditsPenalized: r.creditsPenalized || 0,
        cancelCount: r.cancelCount || 0,
        potentialPenalty: timer.potentialPenalty ?? 0,
        penaltyThresholdMinutes: timer.penaltyThresholdMinutes,
        cancellationPenalty: timer.cancellationPenalty,

        // ─── Reel Media (only for reels/post tasks) ──────────────────
        s3Key: r.s3Key || '',
        s3Url,

        // ─── Campaign ────────────────────────────────────────────────
        campaign: {
          _id: campaign?._id || r.campaignId,
          campaignName: campaign?.campaignName || r.campaignName || '',
          brandName: campaign?.brandName || '',
          clientId: campaign?.clientId || '',
          description: campaign?.description || '',
          goal: campaign?.goal || '',
          views: campaign?.views || '',
          credits: campaign?.credits || 0,
          cutoff: campaign?.cutoff || 0,
          tNc: campaign?.tNc || '',
          tags: campaign?.tags || [],
          location: campaign?.location || '',
          status: campaign?.status || '',
          campaignType: campaign?.campaignType || 'private',
          supportedTaskTypes: campaign?.supportedTaskTypes || [],
          autoApproval: !!campaign?.autoApproval,
          startDate: campaign?.startDate || null,
          endDate: campaign?.endDate || null,
          image: { key: imgKey, url: campaignImageUrl },
          brandImage: { key: campaign?.brandImage?.key || '', url: brandImageUrl },
        },

        // ─── Submission ───────────────────────────────────────────────
        submission: (() => {
          // UGC tasks — use UGCSubmission scoped to this campaignTaskId
          if ((r.contentCategory === 'ugc' || contentCategory === 'ugc')) {
            const ugcSub = ugcSubmissionMap.get(String(r.campaignTaskId));
            if (!ugcSub) return null;
            return {
              _id: ugcSub._id,
              status: ugcSub.status,
              videoKey: ugcSub.videoKey,
              videoUrl: ugcSub.videoUrl,
              videoDuration: ugcSub.videoDuration,
              creditsEarned: ugcSub.creditsEarned,
              creditsAwarded: ugcSub.creditsAwarded,
              submittedAt: ugcSub.createdAt,
              updatedAt: ugcSub.updatedAt,
            };
          }
          // URL-based tasks (reels, post, app_review, gmb_review)
          return userRespEntry ? {
            url: userRespEntry.urls,
            status: userRespEntry.status,
            submittedAt: userRespEntry.createdAt,
            currentViews: userRespEntry.views || 0,
            currentLikes: userRespEntry.likes || 0,
            currentComments: userRespEntry.comments || 0,
            creditAmount: userRespEntry.creditAmount || 0,
            isCreditAccepted: userRespEntry.isCreditAccepted || false,
          } : null;
        })(),
      };
    }));

    if (legacyFixed && shared) {
      shared.reels.forEach((r) => normalizeReelAcceptState(r));
      await shared.save();
    }
    res.status(200).json({ success: true, reels: reelsWithFreshUrls, total, page, limit, totalPages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add or update a user's response URL
exports.addUserResponseUrl = async (req, res) => {
  const { userId } = req.params;
  const { url, campaignId, reelId } = req.body;
  if (!userId || !url || !campaignId) {
    return res.status(400).json({ error: 'userId (param) and url, campaignId (body) are required.' });
  }
  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const creditAmount = campaign.credits || 0;
    const cutoff = campaign.cutoff || 0;
    let views = 0;
    let likes = 0;
    let comments = 0;
    try {
      const stats = await getPostStats(url);
      views = parseInt(stats.views || 0, 10);
      likes = parseInt(stats.likes || 0, 10);
      comments = parseInt(stats.comments || 0, 10);
    } catch (statsErr) {
      console.warn('[addUserResponseUrl] Could not fetch initial stats:', statsErr.message);
    }
    let userResponse = await UserResponse.findOne({ googleId: userId });
    const responseEntry = {
      urls: url, campaignId, reelId,
      isTaskCompleted: false,
      views, likes, comments, cutoff,
      isCreditAccepted: false,
      creditAmount,
      status: 'pending'
    };
    if (!userResponse) {
      userResponse = new UserResponse({ googleId: userId, response: [responseEntry] });
    } else {
      userResponse.response.push(responseEntry);
    }
    await userResponse.save();

    await syncSharedReelSubmission(userId, reelId, campaignId, 'submit');

    // Write pending transaction so history shows submission immediately
    try {
      if (creditAmount > 0) {
        const wallet = await CreditWallet.findOne({ userId }).lean();
        await TransactionHistory.create({
          userId,
          type: 'earning',
          amount: creditAmount,
          description: `Task submitted for review: ${campaign.campaignName}`,
          referenceType: 'campaign',
          referenceId: String(campaignId),
          status: 'pending',
          meta: {
            campaignId: String(campaignId),
            taskId: String(reelId || ''),
            reason: 'Awaiting view count cutoff or manual approval',
          },
          balanceAfter: wallet?.totalBalance || 0,
        });
      }
    } catch (txErr) {
      console.error('[addUserResponseUrl] transaction history write failed:', txErr.message);
    }

    const profile = await resolveOneUserProfile(userId);
    telegramAlerts
      .alertUserEarn({
        userName: profile.name,
        email: profile.email,
        mobile: profile.mobile,
        credits: creditAmount,
        campaignName: campaign.campaignName,
        videoUrl: url,
        note: 'Pending review — credits after approval',
      })
      .catch((err) => console.error('[Telegram] submission alert:', err.message));
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

async function syncCampaignResponseStats(campaignId) {
  const userResponses = await UserResponse.find({ 'response.campaignId': campaignId });
  const updatedUsers = [];
  const allApprovedEntries = [];
  const entries = [];
  const errors = [];

  for (const userResponse of userResponses) {
    let updated = false;
    const approvedEntries = [];

    for (const entry of userResponse.response) {
      if (String(entry.campaignId) !== String(campaignId)) continue;
      if (!entry.urls) continue;

      const platform = detectPlatform(entry.urls);
      let latestViews = 0;
      let latestLikes = 0;
      let latestComments = 0;

      try {
        const stats = await getPostStats(entry.urls);
        latestViews = parseInt(stats.views || 0, 10);
        latestLikes = parseInt(stats.likes || 0, 10);
        latestComments = parseInt(stats.comments || 0, 10);

        if (
          stats.error &&
          latestViews === 0 &&
          latestLikes === 0 &&
          latestComments === 0
        ) {
          errors.push({ url: entry.urls, platform, message: stats.error });
        }

        // Only overwrite stored values if we got real data from the API
        const hasNewData = latestViews > 0 || latestLikes > 0 || latestComments > 0;
        if (hasNewData) {
          entry.views = latestViews;
          entry.likes = latestLikes;
          entry.comments = latestComments;
        } else {
          // Keep existing stored values so UI doesn't regress to 0
          latestViews = entry.views || 0;
          latestLikes = entry.likes || 0;
          latestComments = entry.comments || 0;
        }
        updated = true;

        if (entry.cutoff > 0 && latestViews >= entry.cutoff && !entry.isCreditAccepted) {
          entry.isCreditAccepted = true;
          entry.status = 'approved';
          approvedEntries.push({ url: entry.urls, views: latestViews });

          // Write earning to wallet + transaction history
          try {
            const creditAmount = entry.creditAmount || 0;
            if (creditAmount > 0) {
              const wallet = await CreditWallet.findOneAndUpdate(
                { userId: userResponse.googleId },
                { $inc: { totalBalance: creditAmount, acceptedCredits: creditAmount } },
                { new: true, upsert: true }
              );
              await TransactionHistory.create({
                userId: userResponse.googleId,
                type: 'campaign_reward',
                amount: creditAmount,
                description: `Task completed: views target reached (${latestViews} views)`,
                referenceType: 'campaign',
                referenceId: String(entry.campaignId),
                status: 'completed',
                meta: {
                  campaignId: String(entry.campaignId),
                  taskId: String(entry.reelId || ''),
                  reason: `Views cutoff reached: ${latestViews}/${entry.cutoff}`,
                },
                balanceAfter: wallet.totalBalance,
              });
            }
          } catch (creditErr) {
            console.error('[syncCampaignResponseStats] credit write failed:', creditErr.message);
          }
        }

        entries.push({
          userId: userResponse.googleId,
          url: entry.urls,
          platform,
          views: latestViews,
          likes: latestLikes,
          comments: latestComments,
          cutoff: entry.cutoff,
          isCreditAccepted: entry.isCreditAccepted,
          status: entry.status,
        });
      } catch (err) {
        errors.push({ url: entry.urls, platform, message: err.message });
      }
    }

    if (updated) {
      await userResponse.save();
      updatedUsers.push(userResponse.googleId);
      allApprovedEntries.push(...approvedEntries);
    }
  }

  return { updatedUsers, allApprovedEntries, entries, errors };
}

exports.approveCreditsForUser = async (req, res) => {
  const { campaignId } = req.params;
  try {
    const result = await syncCampaignResponseStats(campaignId);
    res.json({
      success: true,
      updated: result.updatedUsers.length > 0,
      updatedUsers: result.updatedUsers,
      approvedEntries: result.allApprovedEntries,
      entries: result.entries,
      errors: result.errors,
    });
  } catch (err) {
    console.error('Error in approveCreditsForUser:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getYoutubeVideoStats = async (req, res) => {
  const url = req.query.url || req.body.url;
  const videoId = req.query.videoId || req.body.videoId;

  try {
    if (url) {
      const stats = await getPostStats(url);
      return res.json({ success: true, stats, platform: stats.platform });
    }
    if (videoId) {
      const stats = await getYoutubeStats(videoId);
      return res.json({ success: true, stats });
    }
    return res.status(400).json({ success: false, error: 'url or videoId is required' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Update isTaskComplete to true for a specific reel
exports.updateTaskCompleted = async (req, res) => {
  const { userId, reelId } = req.params;
  const { campaignId } = req.body || {};
  try {
    const updated = await syncSharedReelSubmission(userId, reelId, campaignId, 'complete');
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Reel not found for this user' });
    }
    res.json({
      success: true,
      message: 'Task marked completed',
      updatedReel: updated,
    });
  } catch (err) {
    console.error('Error updating task completed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── Unified Task Submit ─────────────────────────────────────────────────────
// POST /api/pools/task/submit
// Supports all 5 task types: reels, post, ugc, app_review, gmb_review
// Content-Type: multipart/form-data (ugc) OR application/json (others)
exports.submitTask = [
  // multer: only parse file if present, skip for JSON tasks
  (() => {
    const multer = require('multer');
    return multer({ limits: { fileSize: 200 * 1024 * 1024 } }).single('video');
  })(),
  async (req, res) => {
    try {
      const userId        = req.body.userId;
      const campaignId    = req.body.campaignId;
      const campaignTaskId = req.body.campaignTaskId || req.body.reelId;
      const reelId        = req.body.reelId || campaignTaskId;
      const contentCategory = req.body.contentCategory;
      const url           = req.body.url;           // reels / post
      const proofUrl      = req.body.proofUrl;      // app_review / gmb_review
      const proofKey      = req.body.proofKey || '';

      if (!userId || !campaignId || !contentCategory) {
        return res.status(400).json({ success: false, message: 'userId, campaignId, contentCategory are required' });
      }

      // ── UGC: video file upload ──────────────────────────────────────────────
      if (contentCategory === 'ugc') {
        if (!campaignTaskId || !req.file) {
          return res.status(400).json({ success: false, message: 'campaignTaskId and video file are required for ugc' });
        }
        const { s3Client, getobject } = require('../utils/r2');
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const UGCSubmission = require('../models/UGCSubmission');
        const ffmpeg = require('fluent-ffmpeg');
        const ffprobeStatic = require('ffprobe-static');
        const os = require('os');
        const path = require('path');
        const fs = require('fs');
        ffmpeg.setFfprobePath(ffprobeStatic.path);

        const videoDuration = await new Promise((resolve) => {
          const tmp = path.join(os.tmpdir(), `ugc_${Date.now()}.mp4`);
          fs.writeFileSync(tmp, req.file.buffer);
          ffmpeg.ffprobe(tmp, (err, meta) => {
            fs.unlink(tmp, () => {});
            resolve(err ? 0 : Math.floor(meta?.format?.duration || 0));
          });
        });

        const ext = (req.file.originalname || 'video.mp4').split('.').pop() || 'mp4';
        const key = `ugc/${campaignId}/${userId}_${Date.now()}.${ext}`;
        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        }));
        const videoUrl = await getobject(key);
        const creditsEarned = videoDuration;

        const submission = await UGCSubmission.findOneAndUpdate(
          { campaignTaskId, userId },
          { campaignId, campaignTaskId, videoKey: key, videoUrl, status: 'pending', videoDuration, creditsEarned, creditsAwarded: false },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        await SharedReels.updateOne(
          { googleId: userId, 'reels.campaignTaskId': campaignTaskId },
          { $set: { 'reels.$[elem].submissionStatus': 'pending_review', 'reels.$[elem].TaskStatus': 'in_progress' } },
          { arrayFilters: [{ 'elem.campaignTaskId': campaignTaskId }] }
        );
        return res.json({
          success: true,
          message: 'UGC video submitted. Credits awarded after approval.',
          creditsEarned,
          videoDuration,
          submission: { _id: submission._id, status: submission.status, videoUrl, videoDuration, creditsEarned },
        });
      }

      // ── app_review / gmb_review: screenshot proof ───────────────────────────
      if (contentCategory === 'app_review' || contentCategory === 'gmb_review') {
        const taskId = campaignTaskId;
        if (!taskId) return res.status(400).json({ success: false, message: 'campaignTaskId required for review tasks' });

        const CampaignTask = require('../models/CampaignTask');
        const task = await CampaignTask.findById(taskId);
        if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

        const isAssigned = (task.assignedTo || []).includes(userId);
        if (task.visibility !== 'public' && !isAssigned) {
          return res.status(400).json({ success: false, message: 'Task not available for this user' });
        }
        const alreadySubmitted = task.submissions.some(s => s.userId === userId && s.status !== 'rejected');
        if (alreadySubmitted) return res.status(400).json({ success: false, message: 'Already submitted' });

        task.submissions = task.submissions.filter(s => !(s.userId === userId && s.status === 'rejected'));
        task.submissions.push({ userId, proofUrl: proofUrl || '', proofKey, submittedAt: new Date(), status: 'pending' });
        await task.save();
        await syncSharedReelSubmission(userId, taskId, task.campaignId, 'submit');

        return res.json({
          success: true,
          message: 'Proof submitted. Pending review.',
          TaskStatus: 'in_progress',
          submissionStatus: 'pending_review',
        });
      }

      // ── reels / post: URL submission ────────────────────────────────────────
      if (contentCategory === 'reels' || contentCategory === 'post') {
        if (!url) return res.status(400).json({ success: false, message: 'url is required for reels/post tasks' });

        const campaign = await Campaign.findById(campaignId);
        if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

        const creditAmount = campaign.credits || 0;
        const cutoff = campaign.cutoff || 0;
        let views = 0, likes = 0, comments = 0;
        try {
          const stats = await getPostStats(url);
          views    = parseInt(stats.views    || 0, 10);
          likes    = parseInt(stats.likes    || 0, 10);
          comments = parseInt(stats.comments || 0, 10);
        } catch (_) {}

        let userResponse = await UserResponse.findOne({ googleId: userId });
        const entry = { urls: url, campaignId, reelId, isTaskCompleted: false, views, likes, comments, cutoff, isCreditAccepted: false, creditAmount, status: 'pending' };
        if (!userResponse) {
          userResponse = new UserResponse({ googleId: userId, response: [entry] });
        } else {
          userResponse.response.push(entry);
        }
        await userResponse.save();
        await syncSharedReelSubmission(userId, reelId, campaignId, 'submit');

        // Check if reel task target is reached
        const { checkAndCompleteReelTask } = require('../utils/reelTaskHelpers');
        let targetCompletion = null;
        if (contentCategory === 'reels' && campaignTaskId) {
          targetCompletion = await checkAndCompleteReelTask(userId, campaignTaskId, campaignId, views, likes, comments);
        }

        try {
          if (creditAmount > 0) {
            const wallet = await CreditWallet.findOne({ userId }).lean();
            await TransactionHistory.create({
              userId, type: 'earning', amount: creditAmount,
              description: `Task submitted for review: ${campaign.campaignName}`,
              referenceType: 'campaign', referenceId: String(campaignId), status: 'pending',
              meta: { campaignId: String(campaignId), taskId: String(reelId || ''), reason: 'Awaiting approval' },
              balanceAfter: wallet?.totalBalance || 0,
            });
          }
        } catch (_) {}

        const profile = await resolveOneUserProfile(userId);
        telegramAlerts.alertUserEarn({
          userName: profile.name, email: profile.email, mobile: profile.mobile,
          credits: creditAmount, campaignName: campaign.campaignName, videoUrl: url,
          note: targetCompletion?.completed ? `Task auto-completed! ${targetCompletion.completionPercent}% target reached. ${targetCompletion.creditsAwarded} credits awarded.` : 'Pending review — credits after approval',
        }).catch(() => {});

        return res.json({ 
          success: true, 
          userResponse,
          targetCompletion: targetCompletion || undefined,
        });
      }

      return res.status(400).json({ success: false, message: `Unknown contentCategory: ${contentCategory}` });
    } catch (err) {
      console.error('[submitTask]', err);
      res.status(500).json({ success: false, message: err.message });
    }
  },
];

// Legacy Android — delegates to unified accept
exports.updateTaskAccepted = async (req, res) => {
  const { userId, reelId } = req.params;
  const { campaignId } = req.body || req.query || {};
  try {
    const result = await acceptUserTask({ userId, reelId, campaignId });
    return res.status(result.status).json({
      success: result.ok,
      message: result.message,
      updatedReel: result.updatedReel,
      quota: result.quota,
      timerExpired: result.timerExpired ?? false,
      penaltyZone: result.penaltyZone ?? false,
      potentialPenalty: result.potentialPenalty ?? 0,
      penaltyThresholdMinutes: result.penaltyThresholdMinutes,
      cancellationPenalty: result.cancellationPenalty,
    });
  } catch (err) {
    console.error('Error updating task accepted:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateTaskStatusAccepted = async (req, res) => {
  return res.status(501).json({ error: 'Not implemented' });
};

// Legacy Android — POST /shared/task-accepted/:userId/:reelId
exports.acceptTaskStatus = async (req, res) => {
  const { userId, reelId } = req.params;
  const { campaignId } = req.body || req.query || {};
  try {
    const result = await acceptUserTask({ userId, reelId, campaignId });
    return res.status(result.status).json({
      success: result.ok,
      message: result.message,
      updatedReel: result.updatedReel,
      quota: result.quota,
      timerExpired: result.timerExpired ?? false,
      penaltyZone: result.penaltyZone ?? false,
      potentialPenalty: result.potentialPenalty ?? 0,
      penaltyThresholdMinutes: result.penaltyThresholdMinutes,
      cancellationPenalty: result.cancellationPenalty,
    });
  } catch (err) {
    console.error('Error updating TaskStatus:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// Update TaskStatus to 'completed' for a specific reel (POST)
exports.completeTaskStatus = async (req, res) => {
  const { userId, reelId } = req.params;
  try {
    if (!userId || !reelId) {
      return res.status(400).json({ error: 'Missing userId or reelId' });
    }
    // Find the user's SharedReels document
    const sharedReels = await SharedReels.findOne({ googleId: userId });
    if (!sharedReels) {
      return res.status(404).json({ error: 'User shared reels not found' });
    }
    // Find the specific reel and update TaskStatus
    const reelIndex = sharedReels.reels.findIndex(reel => 
      reel.reelId.toString() === reelId || reel._id.toString() === reelId
    );
    if (reelIndex === -1) {
      return res.status(404).json({ error: 'Reel not found for this user' });
    }
    // Update TaskStatus to 'completed'
    sharedReels.reels[reelIndex].TaskStatus = 'completed';
    await sharedReels.save();
    res.json({ 
      success: true, 
      message: 'Task status updated to completed',
      updatedReel: sharedReels.reels[reelIndex]
    });
  } catch (err) {
    console.error('Error updating TaskStatus:', err);
    res.status(500).json({ error: err.message });
  }
};

// Accept task — unified with legacy routes
exports.acceptTask = async (req, res) => {
  const { userId, reelId, campaignId } = req.body;
  try {
    const result = await acceptUserTask({ userId, reelId, campaignId });
    return res.status(result.status).json({
      success: result.ok,
      message: result.message,
      updatedReel: result.updatedReel,
      quota: result.quota,
      timerExpired: result.timerExpired ?? false,
      penaltyZone: result.penaltyZone ?? false,
      potentialPenalty: result.potentialPenalty ?? 0,
      penaltyThresholdMinutes: result.penaltyThresholdMinutes,
      cancellationPenalty: result.cancellationPenalty,
      remainingMs: result.remainingMs,
      phase: result.phase,
    });
  } catch (err) {
    console.error('Error accepting task:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Reject task - Update TaskStatus to 'rejected'
exports.rejectTask = async (req, res) => {
  const { userId, reelId, campaignId } = req.body;
  try {
    if (!userId || !reelId) {
      return res.status(400).json({ error: 'Missing userId or reelId' });
    }
    
    // Find the user's SharedReels document
    const sharedReels = await SharedReels.findOne({ googleId: userId });
    if (!sharedReels) {
      return res.status(404).json({ error: 'User shared reels not found' });
    }
    
    // Find the specific reel and update status
    const reelIndex = sharedReels.reels.findIndex(reel => 
      reel.reelId.toString() === reelId && 
      (campaignId ? reel.campaignId === campaignId : true)
    );
    
    if (reelIndex === -1) {
      return res.status(404).json({ error: 'Reel not found for this user' });
    }
    
    // Update task status to rejected
    sharedReels.reels[reelIndex].TaskStatus = 'rejected';
    sharedReels.reels[reelIndex].isTaskAccepted = false;
    await sharedReels.save();
    
    res.json({ 
      success: true, 
      message: 'Task rejected successfully',
      updatedReel: sharedReels.reels[reelIndex]
    });
  } catch (err) {
    console.error('Error rejecting task:', err);
    res.status(500).json({ error: err.message });
  }
};