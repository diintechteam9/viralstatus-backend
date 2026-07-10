const Client = require('../models/client');
const Campaign = require('../models/campaign');
const Group = require('../models/group');
const crypto = require('crypto');
const { putobject, getobject, s3Client } = require('../utils/r2');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const RegisteredCampaign = require('../models/RegisteredCampaign');
const userResponse = require('../models/userResponse');
const sharp = require('sharp');
const campaign = require('../models/campaign');
const TelegramServiceController = require('./telegram/telegrambotalertcontroller');
const telegramService = new TelegramServiceController();
const TelegramSettings = require('../models/Settings');
const telegramAlerts = require('../utils/telegramAlerts');
const { parseSupportedTaskTypes } = require('../utils/campaignTaskTypes');
const { resolveOneUserProfile } = require('../utils/resolveUserProfiles');
const locationService = require('../services/locationFilterService');
const geoJsonService = require('../services/geoJsonService');
const MobileUser = require('../models/MobileUser');
const SharedReels = require('../models/SharedReels');

/** Normalize client id for Campaign.clientId (MongoDB Client _id as string, or legacy). */
async function resolveCampaignClientStorageId(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === 'undefined' || s === 'null') return null;
  if (/^[a-f0-9]{24}$/i.test(s)) return s;
  if (/^CLI-/i.test(s)) {
    const client = await Client.findOne({ clientId: s.toUpperCase() }).lean();
    return client ? String(client._id) : null;
  }
  return null;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validateDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) return false;
  return start < end;
}

function formatCampaignStartMessage(c) {
  const start = c.startDate ? new Date(c.startDate).toLocaleString('en-US') : '-';
  const end = c.endDate ? new Date(c.endDate).toLocaleString('en-US') : '-';
  const createdAt = c.createdAt ? new Date(c.createdAt).toLocaleString('en-US') : '-';
  const tags = Array.isArray(c.tags) && c.tags.length ? c.tags.map(escapeHtml).join(', ') : '-';
  const groupIds = Array.isArray(c.groupIds) && c.groupIds.length ? c.groupIds.map(escapeHtml).join(', ') : '-';
  const members = Array.isArray(c.userIds) ? c.userIds.length : 0;
  const lines = [
    `🚀 <b>New Campaign Created</b>`,
    `\n<b>Name:</b> ${escapeHtml(c.campaignName)}`,
    `<b>Brand:</b> ${escapeHtml(c.brandName)}`,
    `<b>Goal:</b> ${escapeHtml(c.goal)}`,
    `<b>Status:</b> ${escapeHtml(c.status || '-')}`,
    `<b>Created At:</b> ${createdAt}`,
    `<b>Start:</b> ${start}`,
    `<b>End:</b> ${end}`,
    `<b>Credits:</b> ${String(c.credits !== undefined ? c.credits : '-')}`,
    `<b>Target Channels:</b> ${String(c.limit !== undefined ? c.limit : '-')}`,
    `<b>Target Views:</b> ${String(c.views !== undefined ? c.views : '-')}`,
    `<b>Cutoff:</b> ${String(c.cutoff !== undefined ? c.cutoff : '-')}`,
    `<b>Location:</b> ${escapeHtml(c.location || '-')}`,
    `<b>Tags:</b> ${tags}`,
    `<b>Active Participants:</b> ${String(members)}`,
    `<b>Description:</b> ${escapeHtml(c.description || '-')}`,
    `<b>Terms & Conditions:</b> ${escapeHtml(c.tNc || '-')}`,
  ];
  return lines.join('\n');
}

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

// Activate campaigns whose window has started and not yet ended, and status is not 'Inactive'
async function activateCurrentCampaigns() {
  try {
    const now = new Date();
    await Campaign.updateMany(
      {
        isActive: false,
        status: { $ne: 'Inactive' },
        startDate: { $lte: now },
        endDate: { $gte: now },
      },
      { isActive: true }
    );
  } catch (err) {
    console.error('Error activating campaigns:', err);
  }
}

// Deactivate campaigns whose endDate has passed
async function deactivateExpiredCampaigns() {
  try {
    const now = new Date();
    await Campaign.updateMany(
      { isActive: true, endDate: { $lt: now } },
      { isActive: false }
    );
  } catch (err) {
    console.error('Error deactivating campaigns:', err);
  }
}

// Add multer file filter for images only
const imageFileFilter = (req, file, cb) => {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image files are allowed!'), false);
  }
  cb(null, true);
};
const upload = multer({
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadMultiple = multer({
  fileFilter: imageFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'categoryImage', maxCount: 1 },
  { name: 'brandImage', maxCount: 1 },
]);

// Create a new campaign and auto-add groups of the same interest
exports.createCampaign = [
  uploadMultiple,
  async (req, res) => {
    try {
      console.log('BODY:', req.body);
      console.log('FILES:', req.files);
      const {
        campaignName, brandName, goal, clientId, groupIds, tags,
        credits, location, tNc, description, startDate, endDate,
        limit, views, status, members, cutoff, category, campaignType, supportedTaskTypes
      } = req.body;

      const resolvedFromAuth = req.user?.role === 'client' && req.user?.id ? String(req.user.id) : null;
      let rawClientId = clientId;
      if (!rawClientId || rawClientId === 'undefined' || rawClientId === 'null') rawClientId = resolvedFromAuth;
      const normalizedClientId = await resolveCampaignClientStorageId(rawClientId);

      const mainImageFile = req.files?.image?.[0];
      if (!campaignName || !brandName || !goal || !normalizedClientId || !mainImageFile || !description || !startDate || !endDate || !location) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
      }
      
      if (!validateDateRange(startDate, endDate)) {
        return res.status(400).json({ success: false, message: 'End date must be after start date' });
      }

      const campaignId = generateCampaignId(campaignName);

      // Upload main campaign image
      const pngBuffer = await sharp(mainImageFile.buffer).png().toBuffer();
      const originalName = mainImageFile.originalname.replace(/\s+/g, '_').replace(/\.[^/.]+$/, '.png');
      const s3Key = `${normalizedClientId}/${campaignId}/${originalName}`;
      await s3Client.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: s3Key, Body: pngBuffer, ContentType: 'image/png' }));
      const imageUrl = await getobject(s3Key);
      const image = { key: s3Key, url: imageUrl };

      // Upload category image (optional)
      let categoryImage = { key: '', url: '' };
      const categoryImageFile = req.files?.categoryImage?.[0];
      if (categoryImageFile) {
        const catBuf = await sharp(categoryImageFile.buffer).png().toBuffer();
        const catKey = `${normalizedClientId}/${campaignId}/category_${categoryImageFile.originalname.replace(/\s+/g, '_').replace(/\.[^/.]+$/, '.png')}`;
        await s3Client.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: catKey, Body: catBuf, ContentType: 'image/png' }));
        categoryImage = { key: catKey, url: await getobject(catKey) };
      }

      // Upload brand image (optional)
      let brandImage = { key: '', url: '' };
      const brandImageFile = req.files?.brandImage?.[0];
      if (brandImageFile) {
        const brandBuf = await sharp(brandImageFile.buffer).png().toBuffer();
        const brandKey = `${normalizedClientId}/${campaignId}/brand_${brandImageFile.originalname.replace(/\s+/g, '_').replace(/\.[^/.]+$/, '.png')}`;
        await s3Client.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: brandKey, Body: brandBuf, ContentType: 'image/png' }));
        brandImage = { key: brandKey, url: await getobject(brandKey) };
      }

      const now = new Date();
      const startAt = new Date(startDate);
      const endAt = new Date(endDate);
      const statusValue = status || 'Active';
      const computedIsActive = (
        statusValue !== 'Inactive' &&
        startAt instanceof Date && !isNaN(startAt) &&
        endAt instanceof Date && !isNaN(endAt) &&
        startAt <= now && now <= endAt
      );

      const campaign = new Campaign({
        campaignName, brandName, goal,
        clientId: normalizedClientId,
        groupIds: groupIds ? Array.isArray(groupIds) ? groupIds : groupIds.split(',') : [],
        tags: tags ? Array.isArray(tags) ? tags : tags.split(',') : [],
        credits, location, tNc, image, categoryImage, brandImage,
        description, startDate, endDate, limit, views,
        status: statusValue, isActive: computedIsActive,
        cutoff: cutoff !== undefined ? Number(cutoff) : undefined,
        category: category || '',
        campaignType: campaignType === 'public' ? 'public' : 'private',
        supportedTaskTypes: parseSupportedTaskTypes(supportedTaskTypes),
        userIds: members ? (Array.isArray(members) ? members : members.split(',')) : [],
      });
      const savedCampaign = await campaign.save();
      try {
        const settings = await TelegramSettings.findOne();
        const allow = !settings || settings.telegramAlertsEnabledOnCampaignStart !== false;
        if (allow) await telegramService.sendTextMessage(formatCampaignStartMessage(savedCampaign.toObject()));
        // New: Campaign Create alert
        await telegramAlerts.alertCampaignCreate({
          campaignName: savedCampaign.campaignName,
          clientName: savedCampaign.brandName,
          credits: savedCampaign.credits,
          cutoff: savedCampaign.cutoff,
        });
      } catch (alertErr) { console.error('Telegram alert error:', alertErr); }
      res.json({ success: true, campaign: savedCampaign });
    } catch (err) {
      console.error('Campaign creation error:', err);
      res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
  }
];

exports.getActiveCampaigns = async (req, res) => {
  try {
    await activateCurrentCampaigns();
    await deactivateExpiredCampaigns();
    const { clientId: clientIdQuery } = req.query;
    const now = new Date();

    const filter = {
      status: { $ne: 'Inactive' },
      endDate: { $gte: now },
    };

    if (clientIdQuery) {
      const resolved = await resolveCampaignClientStorageId(clientIdQuery);
      if (resolved) filter.clientId = resolved;
    }

    const campaigns = await Campaign.find(filter).lean();

    for (const campaign of campaigns) {
      if (campaign.image?.key) {
        try { campaign.image.url = await getobject(campaign.image.key); } catch {}
      }
      if (campaign.categoryImage?.key) {
        try { campaign.categoryImage.url = await getobject(campaign.categoryImage.key); } catch {}
      }
      if (campaign.brandImage?.key) {
        try { campaign.brandImage.url = await getobject(campaign.brandImage.key); } catch {}
      }
    }
    res.json({ success: true, campaigns });
  } catch (err) {
    console.error('Error in getActiveCampaigns:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get only PUBLIC campaigns (no join required — direct task access)
exports.getPublicActiveCampaigns = async (req, res) => {
  try {
    await activateCurrentCampaigns();
    await deactivateExpiredCampaigns();
    const now = new Date();
    const campaigns = await Campaign.find({
      status: { $ne: 'Inactive' },
      endDate: { $gte: now },
      campaignType: 'public',
    }).lean();
    for (const campaign of campaigns) {
      if (campaign.image?.key) try { campaign.image.url = await getobject(campaign.image.key); } catch {}
      if (campaign.categoryImage?.key) try { campaign.categoryImage.url = await getobject(campaign.categoryImage.key); } catch {}
      if (campaign.brandImage?.key) try { campaign.brandImage.url = await getobject(campaign.brandImage.key); } catch {}
    }
    res.json({ success: true, campaigns });
  } catch (err) {
    console.error('Error in getPublicActiveCampaigns:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get only PRIVATE campaigns (join required — client assigns tasks)
exports.getPrivateActiveCampaigns = async (req, res) => {
  try {
    await activateCurrentCampaigns();
    await deactivateExpiredCampaigns();
    const now = new Date();
    // private mein wo bhi include karo jinpe campaignType set nahi (legacy data)
    const campaigns = await Campaign.find({
      status: { $ne: 'Inactive' },
      endDate: { $gte: now },
      $or: [{ campaignType: 'private' }, { campaignType: { $exists: false } }, { campaignType: null }],
    }).lean();
    for (const campaign of campaigns) {
      if (campaign.image?.key) try { campaign.image.url = await getobject(campaign.image.key); } catch {}
      if (campaign.categoryImage?.key) try { campaign.categoryImage.url = await getobject(campaign.categoryImage.key); } catch {}
      if (campaign.brandImage?.key) try { campaign.brandImage.url = await getobject(campaign.brandImage.key); } catch {}
      // Ensure campaignType is always set in response
      if (!campaign.campaignType) campaign.campaignType = 'private';
    }
    res.json({ success: true, campaigns });
  } catch (err) {
    console.error('Error in getPrivateActiveCampaigns:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Upload campaign image to R2
exports.uploadCampaignImage = [
  upload.single('image'),
  async (req, res) => {
    try {
      const { clientId: rawCid, campaignName } = req.body;
      const clientId = await resolveCampaignClientStorageId(rawCid);
      if (!req.file || !clientId || !campaignName) {
        return res.status(400).json({ success: false, message: 'Missing image, clientId, or campaignName' });
      }
      // Generate campaignId for R2 key
      const campaignId = generateCampaignId(campaignName);
      const originalName = req.file.originalname.replace(/\s+/g, '_');
      const s3Key = `${clientId}/${campaignId}/${originalName}`;
      // Get presigned URL for upload
      const contentType = req.file.mimetype;
      const uploadUrl = await putobject(s3Key, contentType);
      res.json({ success: true, key: s3Key });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'R2 upload error' });
    }
  }
];

// Update a campaign by campaignId
exports.updateCampaign = [
  uploadMultiple,
  async (req, res) => {
  try {
    const { campaignId } = req.params;
    const updateData = { ...req.body };
    if (updateData.cutoff !== undefined) updateData.cutoff = Number(updateData.cutoff);

    const existing = await Campaign.findById(campaignId);
    if (!existing) return res.status(404).json({ success: false, message: 'Campaign not found' });

    if (updateData.startDate && updateData.endDate && !validateDateRange(updateData.startDate, updateData.endDate)) {
      return res.status(400).json({ success: false, message: 'End date must be after start date' });
    }

    // Upload main image if provided
    const mainImageFile = req.files?.image?.[0];
    if (mainImageFile) {
      const pngBuffer = await sharp(mainImageFile.buffer).png().toBuffer();
      const originalName = mainImageFile.originalname.replace(/\s+/g, '_').replace(/\.[^/.]+$/, '.png');
      const s3Key = `${existing.clientId}/${campaignId}/${originalName}`;
      await s3Client.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: s3Key, Body: pngBuffer, ContentType: 'image/png' }));
      updateData.image = { key: s3Key, url: await getobject(s3Key) };
    }

    // Upload category image if provided
    const categoryImageFile = req.files?.categoryImage?.[0];
    if (categoryImageFile) {
      const catBuf = await sharp(categoryImageFile.buffer).png().toBuffer();
      const catKey = `${existing.clientId}/${campaignId}/category_${categoryImageFile.originalname.replace(/\s+/g, '_').replace(/\.[^/.]+$/, '.png')}`;
      await s3Client.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: catKey, Body: catBuf, ContentType: 'image/png' }));
      updateData.categoryImage = { key: catKey, url: await getobject(catKey) };
    }

    // Upload brand image if provided
    const brandImageFile = req.files?.brandImage?.[0];
    if (brandImageFile) {
      const brandBuf = await sharp(brandImageFile.buffer).png().toBuffer();
      const brandKey = `${existing.clientId}/${campaignId}/brand_${brandImageFile.originalname.replace(/\s+/g, '_').replace(/\.[^/.]+$/, '.png')}`;
      await s3Client.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: brandKey, Body: brandBuf, ContentType: 'image/png' }));
      updateData.brandImage = { key: brandKey, url: await getobject(brandKey) };
    }

    const effectiveStart = updateData.startDate ? new Date(updateData.startDate) : existing.startDate;
    const effectiveEnd = updateData.endDate ? new Date(updateData.endDate) : existing.endDate;
    const effectiveStatus = updateData.status !== undefined ? updateData.status : existing.status;
    const now = new Date();

    if (updateData.isActive !== undefined) {
      updateData.isActive = effectiveStatus === 'Inactive' ? false : Boolean(updateData.isActive);
    } else {
      updateData.isActive = (
        effectiveStatus !== 'Inactive' &&
        effectiveStart instanceof Date && !isNaN(effectiveStart) &&
        effectiveEnd instanceof Date && !isNaN(effectiveEnd) &&
        effectiveStart <= now && now <= effectiveEnd
      );
    }

    if (updateData.isActive && existing.isActive !== true) {
      try {
        const settings = await TelegramSettings.findOne();
        const allow = !settings || settings.telegramAlertsEnabledOnCampaignStart !== false;
        if (allow) {
          const toSend = { ...existing.toObject(), ...updateData };
          const text = formatCampaignStartMessage(toSend);
          await telegramService.sendTextMessage(text);
        }
      } catch (alertErr) {
        console.error('Failed to send Telegram start alert on update:', alertErr);
      }
    }

    if (updateData.campaignType !== undefined) {
      updateData.campaignType = updateData.campaignType === 'public' ? 'public' : 'private';
    }
    if (updateData.supportedTaskTypes !== undefined) {
      updateData.supportedTaskTypes = parseSupportedTaskTypes(updateData.supportedTaskTypes);
    }

    const updatedCampaign = await Campaign.findOneAndUpdate({ _id: campaignId }, updateData, { new: true });
    if (!updatedCampaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.json({ success: true, campaign: updatedCampaign });
  } catch (err) {
    console.error('Update campaign error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}];

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
    reg.registeredCampaigns.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));
    const latest = reg.registeredCampaigns.find(
      (c) => c.campaign && c.campaign._id.toString() === campaign._id.toString()
    );
    try {
      const profile = await resolveOneUserProfile(userId);
      await telegramAlerts.alertUserJoin({
        userName: profile.name,
        email: profile.email,
        mobile: profile.mobile,
        city: profile.city,
        campaignName: campaign.campaignName,
        brandName: campaign.brandName,
        registeredAt: latest?.registeredAt || new Date(),
        platform: 'YOHO Mobile App',
      });
    } catch (alertErr) {
      console.error('[Telegram] campaign registration alert:', alertErr.message);
    }
    res.json({ success: true, registeredCampaign: reg });
  } catch (err) {
    console.error('Register campaign error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get a user's registered campaigns by userId or googleId (always fetch fresh campaign data)
exports.getUserRegisteredCampaigns = async (req, res) => {
  try {
    const { userId, googleId } = req.query;
    if (!userId && !googleId) {
      return res.status(400).json({ success: false, message: 'Missing userId or googleId' });
    }

    // In our RegisteredCampaign schema, the field is `userId` (typically googleId)
    const lookupUserId = userId || googleId;
    const reg = await RegisteredCampaign.findOne({ userId: lookupUserId }).lean();
    if (!reg) {
      return res.status(200).json({ success: true, message: 'No registered campaigns found for user', active: [], expired: [] });
    }

    // Extract campaign ids from stored entries (if present)
    const campaignIds = (reg.registeredCampaigns || [])
      .map(e => e?.campaign?._id)
      .filter(Boolean);

    // Fetch fresh campaign documents
    const freshCampaigns = campaignIds.length > 0
      ? await Campaign.find({ _id: { $in: campaignIds } }).lean()
      : [];

    // Map for quick lookup
    const idToCampaign = new Map(freshCampaigns.map(c => [c._id.toString(), c]));

    // Helper to compute active flag from dates/status
    const computeIsActive = (c) => {
      if (!c) return false;
      const status = c.status;
      const start = new Date(c.startDate);
      const end = new Date(c.endDate);
      const now = new Date();
      if (status === 'Inactive') return false;
      if (isNaN(start) || isNaN(end)) return false;
      return start <= now && now <= end;
    };

    // Regenerate presigned URLs and split into active/expired, preserving registeredAt
    const active = [];
    const expired = [];
    for (const entry of reg.registeredCampaigns) {
      try {
        const storedId = entry?.campaign?._id?.toString?.();
        const fresh = storedId ? idToCampaign.get(storedId) : null;
        const campaignObj = fresh || entry.campaign || null;
        if (campaignObj && campaignObj.image && campaignObj.image.key) {
          try {
            campaignObj.image.url = await getobject(campaignObj.image.key);
          } catch (imgErr) {
            console.debug('Failed to get image URL:', imgErr.message);
          }
        }
        const isActive = computeIsActive(campaignObj);
        const item = { campaign: campaignObj, registeredAt: entry.registeredAt };
        if (isActive) active.push(item); else expired.push(item);
      } catch (entryErr) {
        console.error('Error processing campaign entry:', entryErr);
      }
    }

    res.json({ success: true, active, expired });
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
    // $addToSet ensures no duplicates at DB level
    const campaign = await Campaign.findByIdAndUpdate(
      campaignId,
      { $addToSet: { userIds: userId } },
      { new: true }
    );
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }
    res.json({
      success: true,
      activeParticipants: campaign.userIds.length,
      userIds: campaign.userIds
    });
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
    const { clientId: raw } = req.params;
    if (!raw) {
      return res.status(400).json({ success: false, message: 'Missing clientId' });
    }
    const clientId = (await resolveCampaignClientStorageId(raw)) || raw;
    const campaigns = await Campaign.find({ clientId }).lean();

    // Generate fresh presigned GET URLs for each campaign image
    for (const campaign of campaigns) {
      if (campaign.image && campaign.image.key) {
        campaign.image.url = await getobject(campaign.image.key);
      }
      if (campaign.categoryImage?.key) {
        try { campaign.categoryImage.url = await getobject(campaign.categoryImage.key); } catch {}
      }
      if (campaign.brandImage?.key) {
        try { campaign.brandImage.url = await getobject(campaign.brandImage.key); } catch {}
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

// Get participants with location filters
exports.getParticipantsWithLocationFilters = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { pincode, city, state, latitude, longitude, radiusKm, groupBy } = req.query;

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const userIds = campaign.userIds || [];
    if (userIds.length === 0) {
      return res.json({
        success: true,
        participants: [],
        stats: { total: 0, byCity: {}, byPincode: {}, byState: {}, withLocation: 0, withoutLocation: 0 }
      });
    }

    // Build filter object
    const filters = {};
    if (pincode) filters.pincode = pincode;
    if (city) filters.city = city;
    if (state) filters.state = state;
    if (latitude && longitude && radiusKm) {
      filters.latitude = parseFloat(latitude);
      filters.longitude = parseFloat(longitude);
      filters.radiusKm = parseFloat(radiusKm);
    }

    let participants;
    if (Object.keys(filters).length > 0) {
      participants = await locationService.filterParticipantsByLocation(userIds, filters);
    } else {
      participants = await locationService.filterParticipantsByLocation(userIds, {});
    }

    // Get location stats
    const stats = await locationService.getLocationStats(userIds);

    // Group if requested
    let result = participants;
    if (groupBy && ['city', 'pincode', 'state'].includes(groupBy)) {
      const grouped = await locationService.getParticipantsByLocation(userIds, groupBy);
      result = grouped;
    }

    res.json({
      success: true,
      participants: result,
      stats,
      filterApplied: Object.keys(filters).length > 0,
      totalFiltered: Array.isArray(result) ? result.length : Object.values(result).reduce((sum, arr) => sum + arr.length, 0)
    });
  } catch (err) {
    console.error('getParticipantsWithLocationFilters:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get location statistics for campaign participants
exports.getParticipantLocationStats = async (req, res) => {
  try {
    const { campaignId } = req.params;

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const userIds = campaign.userIds || [];
    const stats = await locationService.getLocationStats(userIds);

    res.json({
      success: true,
      campaignId,
      stats
    });
  } catch (err) {
    console.error('getParticipantLocationStats:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

const CITY_COORDINATES = {
  'delhi': { lat: 28.6139, lng: 77.2090 },
  'mumbai': { lat: 19.0760, lng: 72.8777 },
  'bangalore': { lat: 12.9716, lng: 77.5946 },
  'hyderabad': { lat: 17.3850, lng: 78.4867 },
  'chennai': { lat: 13.0827, lng: 80.2707 },
  'kolkata': { lat: 22.5726, lng: 88.3639 },
  'pune': { lat: 18.5204, lng: 73.8567 },
  'ahmedabad': { lat: 23.0225, lng: 72.5714 },
  'jaipur': { lat: 26.9124, lng: 75.7873 },
  'lucknow': { lat: 26.8467, lng: 80.9462 },
  'noida': { lat: 28.5355, lng: 77.3910 },
  'gurugram': { lat: 28.4595, lng: 77.0266 },
  'surat': { lat: 21.1702, lng: 72.8311 },
  'chandigarh': { lat: 30.7333, lng: 76.7794 },
  'indore': { lat: 22.7196, lng: 75.8577 }
};

// Get lightweight city map data for campaign participants
exports.getParticipantCityMap = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const mongoose = require('mongoose');

    const campaign = await Campaign.findById(campaignId).select('userIds').lean();
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const userIds = campaign.userIds || [];
    if (userIds.length === 0) {
      return res.json({
        success: true,
        cities: [],
        participantCount: 0,
        totalCities: 0
      });
    }

    // Convert any valid ObjectId strings to ObjectId types for MongoDB matching
    const objectIds = [];
    for (const id of userIds) {
      if (typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)) {
        objectIds.push(new mongoose.Types.ObjectId(id));
      }
    }

    // Fast count queries using indexed googleId and _id
    const participantCount = await MobileUser.countDocuments({
      $or: [
        { googleId: { $in: userIds } },
        { _id: { $in: objectIds } }
      ]
    });

    // Use MongoDB aggregation pipeline for high-performance grouping
    const results = await MobileUser.aggregate([
      {
        $match: {
          $or: [
            { googleId: { $in: userIds } },
            { _id: { $in: objectIds } }
          ]
        }
      },
      {
        $project: {
          city: { $ifNull: [ "$locationAddress.city", "$city" ] },
          lat: "$location.latitude",
          lng: "$location.longitude"
        }
      },
      {
        $group: {
          _id: "$city",
          count: { $sum: 1 },
          lat: { $first: "$lat" },
          lng: { $first: "$lng" }
        }
      }
    ]);

    const cityCounts = {};
    for (const r of results) {
      let city = r._id;
      if (!city) continue;
      city = city.trim();
      if (!city) continue;

      const lowerCity = city.toLowerCase();
      let canonicalCity = city;
      let latLng = null;

      // Group & normalize coordinates based on major Indian cities
      if (lowerCity.includes('delhi')) {
        canonicalCity = 'Delhi';
        latLng = CITY_COORDINATES['delhi'];
      } else if (lowerCity.includes('mumbai') || lowerCity.includes('bombay')) {
        canonicalCity = 'Mumbai';
        latLng = CITY_COORDINATES['mumbai'];
      } else if (lowerCity.includes('bangalore') || lowerCity.includes('bengaluru')) {
        canonicalCity = 'Bangalore';
        latLng = CITY_COORDINATES['bangalore'];
      } else if (lowerCity.includes('hyderabad')) {
        canonicalCity = 'Hyderabad';
        latLng = CITY_COORDINATES['hyderabad'];
      } else if (lowerCity.includes('chennai') || lowerCity.includes('madras')) {
        canonicalCity = 'Chennai';
        latLng = CITY_COORDINATES['chennai'];
      } else if (lowerCity.includes('kolkata') || lowerCity.includes('calcutta')) {
        canonicalCity = 'Kolkata';
        latLng = CITY_COORDINATES['kolkata'];
      } else if (lowerCity.includes('pune')) {
        canonicalCity = 'Pune';
        latLng = CITY_COORDINATES['pune'];
      } else if (lowerCity.includes('ahmedabad')) {
        canonicalCity = 'Ahmedabad';
        latLng = CITY_COORDINATES['ahmedabad'];
      } else if (lowerCity.includes('jaipur')) {
        canonicalCity = 'Jaipur';
        latLng = CITY_COORDINATES['jaipur'];
      } else if (lowerCity.includes('lucknow')) {
        canonicalCity = 'Lucknow';
        latLng = CITY_COORDINATES['lucknow'];
      } else if (lowerCity.includes('noida')) {
        canonicalCity = 'Noida';
        latLng = CITY_COORDINATES['noida'];
      } else if (lowerCity.includes('gurugram') || lowerCity.includes('gurgaon')) {
        canonicalCity = 'Gurugram';
        latLng = CITY_COORDINATES['gurugram'];
      } else if (lowerCity.includes('surat')) {
        canonicalCity = 'Surat';
        latLng = CITY_COORDINATES['surat'];
      } else if (lowerCity.includes('chandigarh')) {
        canonicalCity = 'Chandigarh';
        latLng = CITY_COORDINATES['chandigarh'];
      } else if (lowerCity.includes('indore')) {
        canonicalCity = 'Indore';
        latLng = CITY_COORDINATES['indore'];
      } else {
        // Fallback for other cities: convert to Title Case
        canonicalCity = city.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        if (typeof r.lat === 'number' && typeof r.lng === 'number') {
          latLng = { lat: r.lat, lng: r.lng };
        }
      }

      if (!cityCounts[canonicalCity]) {
        cityCounts[canonicalCity] = {
          city: canonicalCity,
          count: 0,
          lat: latLng ? latLng.lat : null,
          lng: latLng ? latLng.lng : null
        };
      } else if (!cityCounts[canonicalCity].lat && latLng) {
        cityCounts[canonicalCity].lat = latLng.lat;
        cityCounts[canonicalCity].lng = latLng.lng;
      }
      cityCounts[canonicalCity].count += r.count;
    }

    const cityList = Object.values(cityCounts);
    const totalCities = cityList.length;

    // Filter out cities that do not have valid coordinates to prevent frontend Leaflet errors
    const citiesWithCoords = cityList.filter(c => c.lat !== null && c.lng !== null);

    // Sort descending by participant count
    citiesWithCoords.sort((a, b) => b.count - a.count);

    // Take top 10 cities
    const topCities = citiesWithCoords.slice(0, 10);

    res.json({
      success: true,
      cities: topCities,
      participantCount,
      totalCities
    });
  } catch (err) {
    console.error('getParticipantCityMap error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// City coordinates for major Indian cities
const CITY_COORDS = {
  'delhi': { lat: 28.6139, lng: 77.2090 }, 'new delhi': { lat: 28.6139, lng: 77.2090 },
  'mumbai': { lat: 19.0760, lng: 72.8777 }, 'bangalore': { lat: 12.9716, lng: 77.5946 },
  'bengaluru': { lat: 12.9716, lng: 77.5946 }, 'hyderabad': { lat: 17.3850, lng: 78.4867 },
  'chennai': { lat: 13.0827, lng: 80.2707 }, 'kolkata': { lat: 22.5726, lng: 88.3639 },
  'pune': { lat: 18.5204, lng: 73.8567 }, 'ahmedabad': { lat: 23.0225, lng: 72.5714 },
  'jaipur': { lat: 26.9124, lng: 75.7873 }, 'lucknow': { lat: 26.8467, lng: 80.9462 },
  'noida': { lat: 28.5355, lng: 77.3910 }, 'gurugram': { lat: 28.4595, lng: 77.0266 },
  'gurgaon': { lat: 28.4595, lng: 77.0266 }, 'surat': { lat: 21.1702, lng: 72.8311 },
  'chandigarh': { lat: 30.7333, lng: 76.7794 }, 'indore': { lat: 22.7196, lng: 75.8577 },
  'bhopal': { lat: 23.2599, lng: 77.4126 }, 'patna': { lat: 25.5941, lng: 85.1376 },
  'nagpur': { lat: 21.1458, lng: 79.0882 }, 'vadodara': { lat: 22.3072, lng: 73.1812 },
  'coimbatore': { lat: 11.0168, lng: 76.9558 }, 'kochi': { lat: 9.9312, lng: 76.2673 },
  'visakhapatnam': { lat: 17.6868, lng: 83.2185 }, 'agra': { lat: 27.1767, lng: 78.0081 },
  'varanasi': { lat: 25.3176, lng: 82.9739 }, 'meerut': { lat: 28.9845, lng: 77.7064 },
  'faridabad': { lat: 28.4089, lng: 77.3178 }, 'ghaziabad': { lat: 28.6692, lng: 77.4538 },
};

// Get top 10 cities map data for campaign participants
exports.getParticipantCityMap = async (req, res) => {
  try {
    const { campaignId } = req.params;

    const campaign = await Campaign.findById(campaignId).select('userIds').lean();
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const userIds = campaign.userIds || [];
    if (userIds.length === 0) {
      return res.json({ success: true, cities: [], participantCount: 0, totalCities: 0 });
    }

    const participants = await MobileUser.find({ googleId: { $in: userIds } })
      .select('city locationAddress').lean();

    // Count by city
    const cityCount = {};
    for (const p of participants) {
      const city = (p.locationAddress?.city || p.city || '').trim();
      if (!city) continue;
      cityCount[city] = (cityCount[city] || 0) + 1;
    }

    // Top 10 cities with known coordinates
    const cities = Object.entries(cityCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([city, count]) => {
        const coords = CITY_COORDS[city.toLowerCase()];
        return coords ? { city, count, lat: coords.lat, lng: coords.lng } : null;
      })
      .filter(Boolean);

    res.json({ success: true, cities, participantCount: participants.length, totalCities: Object.keys(cityCount).length });
  } catch (err) {
    console.error('getParticipantCityMap:', err);
    res.status(500).json({ success: false, message: err.message });
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
    const { getobject } = require('../utils/r2');

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
      try {
        // entry: { campaign, registeredAt }
        const camp = entry.campaign;
        const campaignId = camp?._id?.toString?.() || camp?._id || camp?.campaignId;
        const campaignName = camp?.campaignName || '';
        const key = camp?.image?.key || '';
        let url = '';
        try {
          url = key ? await getobject(key) : '';
        } catch (imgErr) {
          console.debug('Failed to get image URL:', imgErr.message);
        }
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
      } catch (err) {
        console.error('Error processing campaign:', err);
        return null;
      }
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

// Get GeoJSON boundaries and participant locations for campaign
exports.getParticipantGeoJSON = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const mongoose = require('mongoose');

    const campaign = await Campaign.findById(campaignId).select('userIds').lean();
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const userIds = campaign.userIds || [];
    if (userIds.length === 0) {
      return res.json({
        success: true,
        geojson: { type: 'FeatureCollection', features: [] },
        bounds: null,
        center: null,
        participants: []
      });
    }

    const objectIds = [];
    for (const id of userIds) {
      if (typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)) {
        objectIds.push(new mongoose.Types.ObjectId(id));
      }
    }

    // Retrieve all participants for the campaign
    const users = await MobileUser.find({
      $or: [
        { googleId: { $in: userIds } },
        { _id: { $in: objectIds } }
      ]
    }).select('name email city pincode location locationAddress').lean();

    const pincodes = [...new Set(users.map(u => u.pincode || u.locationAddress?.pincode).filter(Boolean))];

    let geojson = { type: 'FeatureCollection', features: [] };
    let bounds = null;
    let center = null;

    if (pincodes.length > 0) {
      geojson = await geoJsonService.createFeatureCollection(pincodes);
      bounds = await geoJsonService.getBoundsForPincodes(pincodes);
      center = await geoJsonService.getCenterForPincodes(pincodes);
    }

    // Format participant markers
    const participants = users.map(u => {
      const lat = u.location?.latitude || null;
      const lng = u.location?.longitude || null;
      return {
        id: u._id,
        name: u.name || 'Anonymous User',
        email: u.email || '',
        city: u.locationAddress?.city || u.city || '',
        pincode: u.locationAddress?.pincode || u.pincode || '',
        lat,
        lng,
        address: u.locationAddress?.formattedAddress || ''
      };
    });

    res.json({
      success: true,
      geojson,
      bounds,
      center,
      pincodeCount: pincodes.length,
      participants
    });
  } catch (err) {
    console.error('getParticipantGeoJSON error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};  