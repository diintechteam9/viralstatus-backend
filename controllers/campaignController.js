const Campaign = require('../models/campaign');
const Group = require('../models/group');
const crypto = require('crypto');
const { putobject, getobject } = require('../utils/s3');
const multer = require('multer');
const RegisteredCampaign = require('../models/RegisteredCampaign');
const sharp = require('sharp');

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

// Get all active campaigns (isActive: true)
exports.getActiveCampaigns = async (req, res) => {
  try {
    await deactivateExpiredCampaigns(); // Ensure expired campaigns are deactivated
    const { clientId } = req.query;
    const filter = { isActive: true };
    const Client = require('../models/client');
    if (clientId) {
      // If clientId is a MongoDB _id, fetch the client document and use its clientId field
      const clientDoc = await Client.findById(clientId);
      if (clientDoc) {
        filter.clientId = clientDoc.clientId || clientDoc._id;
      } else {
        // If not found, fallback to using the provided clientId directly
        filter.clientId = clientId;
      }
    }

    // Fetch user by id from JWT, then get googleId
    let registeredCampaignIds = [];
    if (req.user && req.user.id) {
      const userDoc = await require('../models/user').findById(req.user.id);
      const googleId = userDoc ? userDoc.googleId : undefined;
      console.log(googleId);
      if (googleId) {
        const reg = await RegisteredCampaign.findOne({ userId: googleId });
        if (reg && reg.registeredCampaigns) {
          registeredCampaignIds = reg.registeredCampaigns.map(c => c._id?.toString?.() || c._id);
        }
      }
    }
    if (registeredCampaignIds.length > 0) {
      filter._id = { $nin: registeredCampaignIds };
    }

    const campaigns = await Campaign.find(filter).lean();

    // Generate fresh presigned GET URLs for each campaign image
    for (const campaign of campaigns) {
      if (campaign.image && campaign.image.key) {
        campaign.image.url = await getobject(campaign.image.key);
      }
    }
    res.json({ success: true, campaigns });
  } catch (err) {
    console.error(err);
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
      reg = new RegisteredCampaign({ userId, registeredCampaigns: [campaign] });
    } else {
      // Only add if not already present (by _id)
      if (!reg.registeredCampaigns.some(c => c._id.toString() === campaign._id.toString())) {
        reg.registeredCampaigns.push(campaign);
      }
    }
    await reg.save();
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
      reg = await RegisteredCampaign.findOne({ userId });
    } else if (googleId) {
      reg = await RegisteredCampaign.findOne({ googleId });
    }
    if (!reg) {
      return res.status(404).json({ success: false, message: 'No registered campaigns found for user' });
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

