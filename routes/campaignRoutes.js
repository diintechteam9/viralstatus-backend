const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');
const { authenticate, authorize } = require('../middleware/authenticate');
const { verifyToken } = require('../middleware/authmiddleware');

// Create campaign — client only
router.post('/', authenticate, authorize('client', 'admin', 'super_admin'), campaignController.createCampaign);

// Upload campaign image
router.post('/upload', authenticate, authorize('client', 'admin', 'super_admin'), campaignController.uploadCampaignImage);

// Get all active campaigns — all logged in users
router.get('/active', verifyToken, campaignController.getActiveCampaigns);

// Update campaign
router.put('/:campaignId', authenticate, authorize('client', 'admin', 'super_admin'), campaignController.updateCampaign);

// Delete campaign
router.delete('/:campaignId', authenticate, authorize('client', 'admin', 'super_admin'), campaignController.deleteCampaign);

// Register user for campaign
router.post('/register/:campaignId', campaignController.registeredCampaign);

// Get user registered campaigns
router.get('/registered', campaignController.getUserRegisteredCampaigns);

// Get/Set active participants
router.get('/activeparticipants/:campaignId', campaignController.getActiveParticipants);
router.post('/activeparticipants/:campaignId', campaignController.setActiveParticipant);

// Get campaigns by clientId
router.get('/client/:clientId', campaignController.getCampaignsByClientId);

// Get campaign data
router.get('/data/:campaignId', campaignController.getCamapignData);
router.get('/videos/:campaignId', campaignController.getCampaignResponseUrls);
router.get('/client/data/:clientId', campaignController.getAllClientsCampaignData);
router.get('/response/data/:userId', campaignController.getUserDashboardStats);
router.get('/response/campaign/data/:userId', campaignController.getUserCampaignData);

// Get campaign by ID
router.get('/:campaignId', async (req, res) => {
  try {
    const Campaign = require('../models/campaign');
    const campaign = await Campaign.findOne({ _id: req.params.campaignId });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;