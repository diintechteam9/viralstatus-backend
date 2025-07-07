const Campaign = require('../models/campaign');
const Group = require('../models/group');
const crypto = require('crypto');
const { putobject, getobject } = require('../utils/s3');
const multer = require('multer');

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

// Deactivate campaigns whose endTime has passed
async function deactivateExpiredCampaigns() {
  const now = new Date();
  await Campaign.updateMany({ isActive: true, endTime: { $lt: now } }, { isActive: false });
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
        status
      } = req.body;
      if (!campaignName || !brandName || !goal || !clientId || !req.file || !description || !startDate || !endDate || !limit || !views || !credits || !location) {
        return res.status(400).json({ success: false, message: 'Missing required fields (campaignName, brandName, goal, clientId, image, description, startDate, endDate, limit, views, credits, location)' });
      }
      // Generate campaignId for S3 key
      const campaignId = generateCampaignId(campaignName);
      const originalName = req.file.originalname.replace(/\s+/g, '_');
      const s3Key = `${clientId}/${campaignId}/${originalName}`;
      const contentType = req.file.mimetype;
      console.log('Preparing to upload to S3:', s3Key, contentType);
      // Actually upload the file to S3 using AWS SDK
      const { s3Client } = require('../utils/s3');
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
        Body: req.file.buffer,
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
    if (clientId) filter.clientId = clientId;
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
    const updateData = req.body;
    const updatedCampaign = await Campaign.findOneAndUpdate(
      { campaignId },
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
    const deletedCampaign = await Campaign.findOneAndDelete({ campaignId });
    if (!deletedCampaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    res.json({ success: true, message: 'Campaign deleted', campaign: deletedCampaign });
  } catch (err) {
    console.error('Delete campaign error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}; 