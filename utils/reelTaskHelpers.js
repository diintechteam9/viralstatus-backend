const SharedReels = require('../models/SharedReels');
const CampaignTask = require('../models/CampaignTask');
const CreditWallet = require('../models/CreditWallet');
const TransactionHistory = require('../models/TransactionHistory');

async function checkAndCompleteReelTask(userId, campaignTaskId, campaignId, views, likes, comments) {
  const task = await CampaignTask.findById(campaignTaskId).lean();
  if (!task || task.contentCategory !== 'reels') return null;

  const targetViews = task.targetViews || 0;
  const targetLikes = task.targetLikes || 0;
  const targetComments = task.targetComments || 0;

  // Calculate completion percentage
  let completionPercent = 0;
  let targetsSet = 0;
  if (targetViews > 0) { completionPercent += Math.min(100, (views / targetViews) * 100); targetsSet++; }
  if (targetLikes > 0) { completionPercent += Math.min(100, (likes / targetLikes) * 100); targetsSet++; }
  if (targetComments > 0) { completionPercent += Math.min(100, (comments / targetComments) * 100); targetsSet++; }

  if (targetsSet === 0) return null; // No targets set
  completionPercent = completionPercent / targetsSet;

  // Update SharedReels with current progress
  await SharedReels.updateOne(
    { googleId: userId, 'reels.campaignTaskId': String(campaignTaskId) },
    { $set: {
      'reels.$[elem].currentViews': views,
      'reels.$[elem].currentLikes': likes,
      'reels.$[elem].currentComments': comments,
    }},
    { arrayFilters: [{ 'elem.campaignTaskId': String(campaignTaskId) }] }
  );

  // If 100% complete, auto-complete task
  if (completionPercent >= 100) {
    // Mark task as completed in SharedReels
    await SharedReels.updateOne(
      { googleId: userId, 'reels.campaignTaskId': String(campaignTaskId) },
      { $set: {
        'reels.$[elem].isTaskComplete': true,
        'reels.$[elem].TaskStatus': 'completed',
        'reels.$[elem].submissionStatus': 'approved',
      }},
      { arrayFilters: [{ 'elem.campaignTaskId': String(campaignTaskId) }] }
    );

    // Add to completedByWithMetrics in CampaignTask
    await CampaignTask.updateOne(
      { _id: campaignTaskId },
      { $push: {
        completedByWithMetrics: {
          userId,
          completedAt: new Date(),
          finalViews: views,
          finalLikes: likes,
          finalComments: comments,
        }
      }}
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
        referenceId: String(campaignTaskId),
        status: 'completed',
        meta: {
          campaignId: String(campaignId),
          taskId: String(campaignTaskId),
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
