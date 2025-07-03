const Campaign = require('../models/campaign');
const Group = require('../models/group');
const crypto = require('crypto');

// Helper to extract group index from groupId (e.g., travel-&-tourism-2 => 2)
function getGroupIndex(groupId) {
  const parts = groupId.split('-');
  const last = parts[parts.length - 1];
  const idx = parseInt(last, 10);
  return isNaN(idx) ? 0 : idx;
}

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

// Create a new campaign and auto-add groups of the same interest
exports.createCampaign = async (req, res) => {
  try {
    const { campaignName, businessInterest, maxMembers, startTime, endTime, clientId } = req.body;
    if (!campaignName || !businessInterest || !maxMembers || !startTime || !endTime || !clientId) {
      return res.status(400).json({ success: false, message: 'Missing required fields (including clientId)' });
    }

    // Generate unique campaignId
    const campaignId = generateCampaignId(campaignName);

    // Find all groups with the same businessInterest, sorted by groupId index
    let groups = await Group.find({ groupInterest: businessInterest, isActive: true });
    groups = groups.sort((a, b) => getGroupIndex(a.groupId) - getGroupIndex(b.groupId));

    let groupIds = [];
    let numberOfMembers = 0;
    let numberOfGroups = 0;

    for (let group of groups) {
      if (numberOfMembers + group.numberOfMembers > maxMembers) break;
      groupIds.push(group.groupId);
      numberOfMembers += group.numberOfMembers;
      numberOfGroups++;
      if (numberOfMembers >= maxMembers) break;
    }

    const campaign = new Campaign({
      campaignName,
      campaignId,
      businessInterest,
      numberOfGroups,
      numberOfMembers,
      maxMembers,
      groupIds,
      startTime,
      endTime,
      isActive: true,
      clientId
    });
    await campaign.save();
    res.json({ success: true, campaign });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get all active campaigns (isActive: true)
exports.getActiveCampaigns = async (req, res) => {
  try {
    await deactivateExpiredCampaigns(); // Ensure expired campaigns are deactivated
    const { clientId } = req.query;
    const filter = { isActive: true };
    if (clientId) filter.clientId = clientId;
    const campaigns = await Campaign.find(filter);
    res.json({ success: true, campaigns });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
}; 