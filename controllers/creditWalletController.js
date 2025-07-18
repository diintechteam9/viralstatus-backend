const CreditWallet = require('../models/CreditWallet');
const UserResponse = require('../models/userResponse');
const Campaign = require('../models/campaign');

exports.syncCreditWallet = async (req, res) => {
  const { userId } = req.params;
  try {
    // Try to find userResponse by googleId or _id
    let userResponse = await UserResponse.findOne({ googleId: userId });
    if (!userResponse && userId.match(/^[0-9a-fA-F]{24}$/)) {
      // Try by Mongo _id if not found by googleId
      userResponse = await UserResponse.findById(userId);
    }
    if (!userResponse) {
      return res.status(404).json({ error: 'User response not found' });
    }

    let totalBalance = 0;
    let acceptedCredits = 0;
    let pendingCredits = 0;
    let rejectedCredits = 0;
    const campaignIdSet = new Set();
    const rejectedCampaignIds = [];

    // First, collect all campaignIds for rejected checks
    for (const entry of userResponse.response) {
      campaignIdSet.add(entry.campaignId);
    }

    // Fetch all campaigns for isActive check
    const campaigns = await Campaign.find({ _id: { $in: Array.from(campaignIdSet) } });
    const campaignActiveMap = {};
    for (const c of campaigns) {
      campaignActiveMap[c._id.toString()] = c.isActive;
    }

    for (const entry of userResponse.response) {
      const isApproved = entry.isCreditAccepted === true;
      const isRejected = entry.isCreditAccepted === false && campaignActiveMap[entry.campaignId] === false;
      const isPending = !isApproved && !isRejected;
      if (isApproved) {
        totalBalance += entry.creditAmount || 0;
        acceptedCredits += 1;
      } else if (isPending) {
        pendingCredits += entry.creditAmount || 0;
      } else if (isRejected) {
        rejectedCredits += entry.creditAmount || 0;
      }
    }

    // Find or create wallet
    let wallet = await CreditWallet.findOne({ userId });
    if (!wallet) {
      wallet = new CreditWallet({ userId });
    }
    wallet.acceptedCredits = acceptedCredits;
    wallet.totalBalance = totalBalance;
    wallet.pendingCredits = pendingCredits;
    wallet.rejectedCredits = rejectedCredits;
    wallet.totalCampaigns = campaignIdSet.size;
    await wallet.save();

    res.json({ success: true, wallet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Fetch CreditWallet info for a user
exports.getCreditWallet = async (req, res) => {
  const { userId } = req.params;
  try {
    const wallet = await CreditWallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({ error: 'Credit wallet not found' });
    }
    res.json({ success: true, wallet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};