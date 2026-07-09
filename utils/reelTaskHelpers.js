const SharedReels = require('../models/SharedReels');
const CampaignTask = require('../models/CampaignTask');
const CreditWallet = require('../models/CreditWallet');
const TransactionHistory = require('../models/TransactionHistory');

async function checkAndCompleteReelTask(userId, campaignTaskId, campaignId, views, likes, comments) {
  const task = await CampaignTask.findById(campaignTaskId).lean();
  if (!task || task.contentCategory !== 'reels') return null;

  const targetViews    = task.targetViews    || 0;
  const targetLikes    = task.targetLikes    || 0;
  const targetComments = task.targetComments || 0;

  // Calculate completion percentage
  let completionPercent = 0;
  let targetsSet = 0;
  if (targetViews    > 0) { completionPercent += Math.min(100, (views    / targetViews)    * 100); targetsSet++; }
  if (targetLikes    > 0) { completionPercent += Math.min(100, (likes    / targetLikes)    * 100); targetsSet++; }
  if (targetComments > 0) { completionPercent += Math.min(100, (comments / targetComments) * 100); targetsSet++; }

  if (targetsSet === 0) return null;
  completionPercent = completionPercent / targetsSet;

  const taskIdStr = String(campaignTaskId);

  // Find the matching SharedReels entry — match by campaignTaskId OR reelId
  const shared = await SharedReels.findOne({
    googleId: userId,
    reels: { $elemMatch: { $or: [{ campaignTaskId: taskIdStr }, { reelId: taskIdStr }] } },
  });

  if (shared) {
    const reelEntry = shared.reels.find(
      r => String(r.campaignTaskId) === taskIdStr || String(r.reelId) === taskIdStr
    );
    if (reelEntry) {
      reelEntry.currentViews    = views;
      reelEntry.currentLikes    = likes;
      reelEntry.currentComments = comments;

      if (completionPercent >= 100) {
        reelEntry.isTaskComplete   = true;
        reelEntry.TaskStatus       = 'completed';
        reelEntry.submissionStatus = 'approved';
      }
      await shared.save();
    }
  }

  if (completionPercent >= 100) {
    // Add to completedByWithMetrics in CampaignTask
    await CampaignTask.updateOne(
      { _id: campaignTaskId },
      { $push: { completedByWithMetrics: { userId, completedAt: new Date(), finalViews: views, finalLikes: likes, finalComments: comments } } }
    );

    // Award credits
    const creditAmount = task.credits || 0;
    if (creditAmount > 0) {
      const wallet = await CreditWallet.findOneAndUpdate(
        { userId },
        { $inc: { totalBalance: creditAmount, acceptedCredits: creditAmount } },
        { new: true, upsert: true }
      );
      await TransactionHistory.create({
        userId,
        type: 'campaign_reward',
        amount: creditAmount,
        description: `Reel task auto-completed: ${task.title} (${Math.round(completionPercent)}% target reached)`,
        referenceType: 'task',
        referenceId: taskIdStr,
        status: 'completed',
        meta: {
          campaignId: String(campaignId),
          taskId: taskIdStr,
          reason: `Target metrics reached: ${views} views, ${likes} likes, ${comments} comments`,
          completionPercent: Math.round(completionPercent),
        },
        balanceAfter: wallet.totalBalance,
      });
    }

    return { completed: true, completionPercent: Math.round(completionPercent), creditsAwarded: creditAmount };
  }

  return { completed: false, completionPercent: Math.round(completionPercent) };
}

module.exports = { checkAndCompleteReelTask };
