const { VALID_TASK_TYPE_IDS } = require('./campaignTaskTypes');

/** Default CampaignTask templates per content category */
function buildTaskTemplate(campaign, contentCategory) {
  const credits = campaign.credits || 10;
  const visibility = campaign.campaignType === 'public' ? 'public' : 'private';
  const base = {
    campaignId: String(campaign._id),
    clientId: campaign.clientId,
    contentCategory,
    credits,
    status: 'active',
    visibility,
    proofRequired: 'screenshot',
    targetCount: 1,
    order: VALID_TASK_TYPE_IDS.indexOf(contentCategory),
  };

  const name = campaign.campaignName || 'Campaign';
  const brand = campaign.brandName || '';

  switch (contentCategory) {
    case 'post':
      return {
        ...base,
        title: `${name} — Social Post`,
        description: `Create and publish a post for ${brand}. Share the post URL or screenshot as proof.`,
        platform: 'instagram',
        taskType: 'share',
        targetUrl: '',
      };
    case 'ugc':
      return {
        ...base,
        title: `${name} — UGC Video`,
        description: `Record a testimonial video for ${brand}. Upload your video in the task screen.`,
        platform: 'both',
        taskType: 'upload_reel',
        proofRequired: 'url',
      };
    case 'app_review':
      return {
        ...base,
        title: `${name} — App Store Review`,
        description: `Leave an honest app review for ${brand}. Upload a screenshot of your published review.`,
        platform: 'both',
        taskType: 'comment',
        targetUrl: '',
      };
    case 'gmb_review':
      return {
        ...base,
        title: `${name} — Google Business Review`,
        description: `Leave a Google Business (GMB) review for ${brand}. Upload a screenshot as proof.`,
        platform: 'both',
        taskType: 'comment',
        targetUrl: '',
      };
    default:
      return null;
  }
}

module.exports = { buildTaskTemplate };
