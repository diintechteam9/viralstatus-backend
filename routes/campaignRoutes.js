const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');

// Create a new campaign
router.post('/', campaignController.createCampaign);

// Upload campaign image to S3
router.post('/upload', campaignController.uploadCampaignImage);

// Get all active campaigns
router.get('/active', campaignController.getActiveCampaigns);

// Update a campaign by campaignId
router.put('/:campaignId', campaignController.updateCampaign);

// Delete a campaign by campaignId
router.delete('/:campaignId', campaignController.deleteCampaign);

// Get campaign details by campaignId
router.get('/:campaignId', async (req, res) => {
  try {
    const Campaign = require('../models/campaign');
    const campaign = await Campaign.findOne({ _id: req.params.campaignId });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }
    res.json({ success: true, campaign });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


module.exports = router; 