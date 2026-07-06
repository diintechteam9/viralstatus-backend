const CreditWallet = require('../models/CreditWallet');
const UserResponse = require('../models/userResponse');
const Campaign = require('../models/campaign');
const UGCSubmission = require('../models/UGCSubmission');

exports.syncCreditWallet = async (req, res) => {
  const userId = String(req.user.id);
  try {
    let userResponse = await UserResponse.findOne({ googleId: userId });
    if (!userResponse && userId.match(/^[0-9a-fA-F]{24}$/)) {
      userResponse = await UserResponse.findById(userId);
    }

    let totalBalance = 0;
    let acceptedCredits = 0;
    let pendingCredits = 0;
    let rejectedCredits = 0;
    const campaignIdSet = new Set();

    if (userResponse) {
      const campaigns = await Campaign.find({ _id: { $in: [...new Set(userResponse.response.map(e => e.campaignId))] } });
      const campaignActiveMap = {};
      for (const c of campaigns) campaignActiveMap[c._id.toString()] = c.isActive;

      for (const entry of userResponse.response) {
        campaignIdSet.add(entry.campaignId);
        const isApproved = entry.isCreditAccepted === true;
        const isRejected = entry.isCreditAccepted === false && campaignActiveMap[entry.campaignId] === false;
        const isPending = !isApproved && !isRejected;
        if (isApproved) { totalBalance += entry.creditAmount || 0; acceptedCredits += 1; }
        else if (isPending) { pendingCredits += entry.creditAmount || 0; }
        else if (isRejected) { rejectedCredits += entry.creditAmount || 0; }
      }
    }

    // UGC credits — userId se match karo (googleId se save hota hai)
    const ugcSubmissions = await UGCSubmission.find({ userId, creditsAwarded: true });
    for (const sub of ugcSubmissions) {
      const earned = sub.creditsEarned || 0;
      if (sub.status === 'approved') {
        totalBalance += earned;
        acceptedCredits += earned;
      } else if (sub.status === 'rejected') {
        rejectedCredits += earned;
      } else {
        pendingCredits += earned; // pending
      }
      campaignIdSet.add(sub.campaignId);
    }

    let wallet = await CreditWallet.findOne({ userId });
    if (!wallet) wallet = new CreditWallet({ userId });
    wallet.totalBalance = totalBalance;
    wallet.acceptedCredits = acceptedCredits;
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
  const userId = String(req.user.id);
  try {
    let wallet = await CreditWallet.findOne({ userId });
    if (!wallet) {
      // If wallet not found, create a new one with default values
      wallet = new CreditWallet({
        userId,
        totalBalance: 0,
        acceptedCredits: 0,
        pendingCredits: 0,
        rejectedCredits: 0,
        totalCampaigns: 0
      });
      await wallet.save();
    }
    res.json({ success: true, wallet });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};