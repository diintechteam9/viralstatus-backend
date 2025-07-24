const Campaign = require('../models/campaign');
const Group = require('../models/group');
const crypto = require('crypto');
const { putobject, getobject } = require('../utils/s3');
const multer = require('multer');
const RegisteredCampaign = require('../models/RegisteredCampaign');
const userResponse = require('../models/userResponse');
const sharp = require('sharp');
const campaign = require('../models/campaign');

// Helper to extract group index from groupId (e.g., travel-&-tourism-2 => 2)
// function getGroupIndex(groupId) {
//   const parts = groupId.split('-');
//   const last = parts[parts.length - 1];
//   const idx = parseInt(last, 10);  
//   return isNaN(idx) ? 0 : idx;
// }

// Helper to generate a unique campaignId from name
function generateCampaignId(name) {
  const base = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

// Deactivate campaigns whose endDate has passed
async function deactivateExpiredCampaigns() {
  const now = new Date();
  await Campaign.updateMany({ isActive: true, endDate: { $lt: now } }, { isActive: false });
}

// Add multer file filter for images only
const imageFileFilter = (req, file, cb) => {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image files are allowed!'), false);
  }
  cb(null, true);
};
const upload = multer({ fileFilter: imageFileFilter });

// Create a new campaign and auto-add groups of the same interest
exports.createCampaign = [
  upload.single('image'),
  async (req, res) => {
    try {
      console.log('BODY:', req.body);
      console.log('FILE:', req.file);
      const {
        campaignName,
        brandName,
        goal,
        clientId,
        groupIds,
        tags,
        credits,
        location,
        tNc,
        description,
        startDate,
        endDate,
        limit,
        views,
        status,
        members,
        cutoff
      } = req.body;
      if (!campaignName || !brandName || !goal || !clientId || !req.file || !description || !startDate || !endDate || !limit || !views || !credits || !location) {
        return res.status(400).json({ success: false, message: 'Missing required fields (campaignName, brandName, goal, clientId, image, description, startDate, endDate, limit, views, credits, location)' });
      }
      // Generate campaignId for S3 key
      const campaignId = generateCampaignId(campaignName);
      // Convert the uploaded image to PNG using sharp
      const pngBuffer = await sharp(req.file.buffer).png().toBuffer();
      // Change the file extension to .png
      const originalName = req.file.originalname.replace(/\s+/g, '_').replace(/\.[^/.]+$/, ".png");
      const s3Key = `${clientId}/${campaignId}/${originalName}`;
      const contentType = 'image/png';
      console.log('Preparing to upload to S3:', s3Key, contentType);
      // Actually upload the file to S3 using AWS SDK
      const { s3Client } = require('../utils/s3');
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
        Body: pngBuffer, // Use the converted PNG buffer
        ContentType: contentType,
      }));
      // Generate presigned GET URL for the uploaded image
      const imageUrl = await getobject(s3Key);
      // Compose image object for DB
      const image = { key: s3Key, url: imageUrl };
      const campaign = new Campaign({
        campaignName,
        brandName,
        goal,
        clientId,
        groupIds: groupIds ? Array.isArray(groupIds) ? groupIds : groupIds.split(',') : [],
        tags: tags ? Array.isArray(tags) ? tags : tags.split(',') : [],
        credits,
        location,
        tNc,
        image,
        description,
        startDate,
        endDate,
        limit,
        views,
        status: status || "Active",
        isActive: true,
        cutoff: cutoff !== undefined ? Number(cutoff) : undefined,
        // members should be an array of googleId strings
        userIds: members ? (Array.isArray(members) ? members : members.split(',')) : [],
      });
      await campaign.save();
      res.json({ success: true, campaign });
    } catch (err) {
      console.error('Campaign creation error:', err);
      res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
  }
];

// Get all active campaigns (isActive: true) user/client specific
exports.getActiveCampaigns = async (req, res) => {
  console.log('getActiveCampaigns called');
  try {
    await deactivateExpiredCampaigns(); // Ensure expired campaigns are deactivated
    const { clientId } = req.query;
    console.log('clientId from query:', clientId);
    const filter = { isActive: true };
    const Client = require('../models/client');
    if (clientId) {
      // If clientId is a MongoDB _id, fetch the client document and use its clientId field
      const clientDoc = await Client.findById(clientId);
      console.log('clientDoc found for clientId:', clientDoc);
      if (clientDoc) {
        filter.clientId = clientDoc.clientId || clientDoc._id;
      } else {
        // If not found, fallback to using the provided clientId directly
        filter.clientId = clientId;
      }
    }

    // Fetch user or client by id from JWT, then get googleId
    let registeredCampaignIds = [];
    let googleId;
    const id = req.user?.id || req.client?.id;

    if (id) {
      console.log('Found ID in request:', id);
      // Try user model first
      const User = require('../models/user');
      const userDoc = await User.findById(id);
      console.log('userDoc:', userDoc);
      if (userDoc && userDoc.googleId) {
        googleId = userDoc.googleId;
        console.log('Found googleId in userDoc:', googleId);
      } else {
        // Try client model if not found in user
        const Client = require('../models/client');
        const clientDoc = await Client.findById(id);
        console.log('clientDoc for id:', clientDoc);
        if (clientDoc && clientDoc.googleId) {
          googleId = clientDoc.googleId;
          console.log('Found googleId in clientDoc:', googleId);
        }
      }
      if (googleId) {
        const RegisteredCampaign = require('../models/RegisteredCampaign');
        const reg = await RegisteredCampaign.findOne({ userId: googleId });
        console.log('RegisteredCampaign for googleId:', reg);
        if (reg && reg.registeredCampaigns) {
          registeredCampaignIds = reg.registeredCampaigns.map(c => c.campaign && c.campaign._id?.toString?.());
          console.log('registeredCampaignIds:', registeredCampaignIds);
        }
      }
    }
    if (registeredCampaignIds.length > 0) {
      filter._id = { $nin: registeredCampaignIds };
      console.log('Filter after excluding registeredCampaignIds:', filter);
    }

    const Campaign = require('../models/campaign');
    const campaigns = await Campaign.find(filter).lean();
    console.log('Campaigns found:', campaigns.length);

    // Generate fresh presigned GET URLs for each campaign image
    for (const campaign of campaigns) {
      if (campaign.image && campaign.image.key) {
        campaign.image.url = await getobject(campaign.image.key);
        console.log('Generated presigned URL for campaign:', campaign._id);
      }
    }
    res.json({ success: true, campaigns });
    console.log('Response sent with campaigns');
  } catch (err) {
    console.error('Error in getActiveCampaigns:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Upload campaign image to S3
exports.uploadCampaignImage = [
  upload.single('image'),
  async (req, res) => {
    try {
      const { clientId, campaignName } = req.body;
      if (!req.file || !clientId || !campaignName) {
        return res.status(400).json({ success: false, message: 'Missing image, clientId, or campaignName' });
      }
      // Generate campaignId for S3 key
      const campaignId = generateCampaignId(campaignName);
      const originalName = req.file.originalname.replace(/\s+/g, '_');
      const s3Key = `${clientId}/${campaignId}/${originalName}`;
      // Get presigned URL for upload
      const contentType = req.file.mimetype;
      const uploadUrl = await putobject(s3Key, contentType);
      res.json({ success: true, key: s3Key });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'S3 upload error' });
    }
  }
];

// Update a campaign by campaignId
exports.updateCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    console.log('campaignId param:', campaignId); // Should print the ObjectId string
    const updateData = req.body;
    if (updateData.cutoff !== undefined) {
      updateData.cutoff = Number(updateData.cutoff);
    }
    console.log('Update data received:', updateData);
    const updatedCampaign = await Campaign.findOneAndUpdate(
      { _id: campaignId },
      updateData,
      { new: true }
    );
    if (!updatedCampaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    res.json({ success: true, campaign: updatedCampaign });
  } catch (err) {
    console.error('Update campaign error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Delete a campaign by campaignId
exports.deleteCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const deletedCampaign = await Campaign.findOneAndDelete({ _id: campaignId });
    if (!deletedCampaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    res.json({ success: true, message: 'Campaign deleted', campaign: deletedCampaign });
  } catch (err) {
    console.error('Delete campaign error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Register a user for a campaign (add full campaign object to user's registeredCampaigns)
exports.registeredCampaign = async (req, res) => {
  try {
    console.log(req.body);
    const { campaignId } = req.params;
    const { userId } = req.body; // You can adapt this to use req.user if using auth middleware
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing userId' });
    }
    // Find the campaign object
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    // Find or create the RegisteredCampaign document for this user
    let reg = await RegisteredCampaign.findOne({ userId });
    if (!reg) {
      reg = new RegisteredCampaign({ userId, registeredCampaigns: [{ campaign, registeredAt: new Date() }] });
    } else {
      // Only add if not already present (by _id)
      if (!reg.registeredCampaigns.some(c => c.campaign && c.campaign._id.toString() === campaign._id.toString())) {
        reg.registeredCampaigns.push({ campaign, registeredAt: new Date() });
      }
    }
    await reg.save();
    // Sort registeredCampaigns by registeredAt descending (most recent first)
    reg.registeredCampaigns.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
    res.json({ success: true, registeredCampaign: reg });
  } catch (err) {
    console.error('Register campaign error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get a user's registered campaigns by userId or googleId
exports.getUserRegisteredCampaigns = async (req, res) => {
  try {
    const { userId, googleId } = req.query;
    if (!userId && !googleId) {
      return res.status(400).json({ success: false, message: 'Missing userId or googleId' });
    }
    let reg;
    if (userId) {
      reg = await RegisteredCampaign.findOne({ userId }).lean();
    } else if (googleId) {
      reg = await RegisteredCampaign.findOne({ googleId }).lean();
    }
    if (!reg) {
      return res.status(404).json({ success: false, message: 'No registered campaigns found for user' });
    }
    for (const entry of reg.registeredCampaigns) {
      if (entry.campaign && entry.campaign.image && entry.campaign.image.key) {
        entry.campaign.image.url = await getobject(entry.campaign.image.key);
      }
    }
    res.json({ success: true, registeredCampaigns: reg.registeredCampaigns });
    console.log(res)
  } catch (err) {
    console.error('Get user registered campaigns error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.setActiveParticipant = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { userId } = req.body;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, message: "userId must be provided as a string" });
    }
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }
    // Only add if not already present
    if (!campaign.userIds.includes(userId)) {
      campaign.userIds.push(userId);  
      // Increment activeParticipants by 1 only if user is new
      campaign.activeParticipants = (campaign.activeParticipants || 0) + 1;
      await campaign.save();
    }
    res.json({
      success: true,
      activeParticipants: campaign.activeParticipants,
      userIds: campaign.userIds
    });
    console.log(res);
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// Get active participants (userIds) for a campaign
exports.getActiveParticipants = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }
    const userIds = campaign.userIds || [];
    res.json({
      success: true,
      activeParticipants: userIds.length,
      userIds
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// Get all campaigns for a client by clientId
exports.getCampaignsByClientId = async (req, res) => {
  try {
    const { clientId } = req.params;
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Missing clientId' });
    }
    const campaigns = await Campaign.find({ clientId }).lean();

    // Generate fresh presigned GET URLs for each campaign image
    for (const campaign of campaigns) {
      if (campaign.image && campaign.image.key) {
        campaign.image.url = await getobject(campaign.image.key);
      }
    }

    res.json({ success: true, campaigns });
  } catch (err) {
    console.error('Error fetching campaigns by clientId:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// get campaigns data 
exports.getCamapignData = async(req, res)=> {
  try{
    const { campaignId } = req.params;
    
    // Find all user responses for this campaign
    const userResponses = await userResponse.find({ 'response.campaignId': campaignId });
    
    let totalResponses = 0;
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    
    // Sum up all metrics from all responses for this campaign
    userResponses.forEach(userResp => {
      userResp.response.forEach(resp => {
        if (String(resp.campaignId) === String(campaignId)) {
          totalResponses++;
          totalViews += resp.views || 0;
          totalLikes += resp.likes || 0;
          totalComments += resp.comments || 0;
        }
      });
    });
    
    res.json({
      success: true,
      campaignId,
      data: {
        totalResponses,
        totalViews,
        totalLikes,
        totalComments
      }
    });
    
  } catch (error) {
    console.error('Error getting campaign data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get campaign data',
      message: error.message
    });
  }
};

// Get all responded URLs (videos) and time for a campaign
exports.getCampaignResponseUrls = async (req, res) => {
  try {
    const { campaignId } = req.params;
    if (!campaignId) {
      return res.status(400).json({ success: false, message: 'Missing campaignId' });
    }

    // Find all userResponses that have at least one response for this campaign
    const userResponses = await userResponse.find({ 'response.campaignId': campaignId });

    // Collect all urls and createdAt for this campaign
    const urls = [];
    userResponses.forEach(userResp => {
      userResp.response.forEach(resp => {
        if (String(resp.campaignId) === String(campaignId) && resp.urls) {
          urls.push({
            url: resp.urls,
            Time: resp.createdAt || userResp.createdAt
          });
        }
      });
    });

    res.json({ success: true, campaignId, urls });
  } catch (err) {
    console.error('Error fetching campaign response URLs:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

//client's total data of his all campaigns
exports.getAllClientsCampaignData = async (req, res) => {
  try {
    const { clientId } = req.params;
    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Missing clientId' });
    }
    // Find all campaigns for this client
    const campaigns = await campaign.find({ clientId });
    if (!campaigns.length) {
      return res.json({
        success: true,
        clientId,
        stats: {
          totalVideos: 0,
          totalViews: 0,
          totalLikes: 0,
          totalComments: 0
        }
      });
    }
    // Get all campaignIds
    const campaignIds = campaigns.map(c => String(c._id));

    // Find all userResponses that have responses for any of these campaigns
    const userResponses = await userResponse.find({ 'response.campaignId': { $in: campaignIds } });

    let totalVideos = 0;
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;

    // Aggregate stats from all responses for these campaigns
    userResponses.forEach(userResp => {
      userResp.response.forEach(resp => {
        if (campaignIds.includes(String(resp.campaignId))) {
          totalVideos++;
          totalViews += resp.views || 0;
          totalLikes += resp.likes || 0;
          totalComments += resp.comments || 0;
        }
      });
    });

    res.json({
      success: true,
      clientId,
      stats: {
        totalVideos,
        totalViews,
        totalLikes,
        totalComments
      }
    });
  } catch (err) {
    console.error('Error in getAllClientsCampaignData:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

//user dashboard data
exports.getUserDashboardStats = async (req, res) => {
  const { userId } = req.params; // userId is googleId
  try {
    // 1. Registered Campaigns
    const RegisteredCampaign = require('../models/RegisteredCampaign');
    const SharedReels = require('../models/SharedReels');
    const userResponse = require('../models/userResponse');

    // Get totalCampaigns
    const regDoc = await RegisteredCampaign.findOne({ userId });
    const totalCampaigns = regDoc && Array.isArray(regDoc.registeredCampaigns) ? regDoc.registeredCampaigns.length : 0;

    // Get acceptedTask from SharedReels (sum of isTaskComplete true in reels[])
    let acceptedTask = 0;
    const sharedReelsDoc = await SharedReels.findOne({ googleId: userId });
    if (sharedReelsDoc && Array.isArray(sharedReelsDoc.reels)) {
      acceptedTask = sharedReelsDoc.reels.filter(r => r.isTaskComplete === true).length;
    }

    // Get userResponse doc
    const responsed = await userResponse.findOne({ googleId: userId });
    let completedTask = 0;
    let pendingTask = 0;
    let totalCredits = 0;
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    if (responsed && Array.isArray(responsed.response)) {
      for (const entry of responsed.response) {
        if (entry.isTaskCompleted) completedTask++;
        if (entry.status === 'pending') pendingTask++;
        if (entry.isCreditAccepted) totalCredits += entry.creditAmount || 0;
        totalViews += entry.views || 0;
        totalLikes += entry.likes || 0;
        totalComments += entry.comments || 0;
      }
    }

    res.json({
      success: true,
      totalCampaigns,
      acceptedTask,
      pendingTask,
      completedTask,
      totalCredits,
      totalViews,
      totalLikes,
      totalComments
    });
  } catch (err) {
    console.error('Error fetching user dashboard stats:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch user dashboard stats', details: err.message });
  }
};

//user dashboard campaign data
exports.getUserCampaignData = async (req, res) => {
  try {
    const { userId } = req.params; // userId is googleId
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing userId (googleId)' });
    }
    const RegisteredCampaign = require('../models/RegisteredCampaign');
    const userResponse = require('../models/userResponse');
    const { getobject } = require('../utils/s3');

    // Find registered campaigns for the user
    const regDoc = await RegisteredCampaign.findOne({ userId });
    if (!regDoc || !Array.isArray(regDoc.registeredCampaigns)) {
      return res.status(200).json({ success: true, campaigns: [], message: 'No registered campaigns found' });
    }
    // Get all user responses for this user
    const userRespDoc = await userResponse.findOne({ googleId: userId });
    const userResponses = userRespDoc && Array.isArray(userRespDoc.response) ? userRespDoc.response : [];

    // Prepare campaign data only for registered campaign objects
    let campaigns = await Promise.all(regDoc.registeredCampaigns.map(async (entry) => {
      // entry: { campaign, registeredAt }
      const camp = entry.campaign;
      const campaignId = camp?._id?.toString?.() || camp?._id || camp?.campaignId;
      const campaignName = camp?.campaignName || '';
      const key = camp?.image?.key || '';
      const url = key ? await getobject(key) : '';
      // Aggregate stats for this campaign from userResponses
      let totalViews = 0, totalLikes = 0, totalComments = 0;
      for (const resp of userResponses) {
        if (String(resp.campaignId) === String(campaignId)) {
          totalViews += resp.views || 0;
          totalLikes += resp.likes || 0;
          totalComments += resp.comments || 0;
        }
      }
      return (campaignId && campaignName) ? {
        campaignId,
        campaignName,
        key,
        url,
        isActive: camp?.isActive,
        registeredAt: entry.registeredAt,
        views: totalViews,
        likes: totalLikes,
        comments: totalComments
      } : null;
    }));
    // Filter out nulls (invalid campaigns)
    campaigns = campaigns.filter(c => c);
    if (campaigns.length === 0) {
      return res.status(200).json({ success: true, campaigns: [], message: 'No registered campaigns found' });
    }
    res.json({ success: true, campaigns });
  } catch (err) {
    console.error('Error in getUserCampaign:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};  