const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');
const { authenticate, authorize } = require('../middleware/authenticate');
const Campaign = require('../models/campaign');

// Create campaign — client only
router.post('/', authenticate, authorize('client', 'admin', 'super_admin'), campaignController.createCampaign);

// Upload campaign image
router.post('/upload', authenticate, authorize('client', 'admin', 'super_admin'), campaignController.uploadCampaignImage);

// Get all active campaigns — public route
router.get('/active', campaignController.getActiveCampaigns);

// Get only PUBLIC type active campaigns (no join required — for Task tab)
router.get('/active/public', campaignController.getPublicActiveCampaigns);

// Get only PRIVATE type active campaigns (join required — for Campaign tab)
router.get('/active/private', campaignController.getPrivateActiveCampaigns);

// Register user for campaign
router.post('/register/:campaignId', campaignController.registeredCampaign);

// Get user registered campaigns
router.get('/registered', campaignController.getUserRegisteredCampaigns);

// Get/Set active participants
router.get('/activeparticipants/:campaignId', campaignController.getActiveParticipants);
router.post('/activeparticipants/:campaignId', campaignController.setActiveParticipant);

// MUST be before /client/:clientId — otherwise "data" is captured as clientId
router.get('/client/data/:clientId', campaignController.getAllClientsCampaignData);

// Get campaigns by clientId (MongoDB Client _id)
router.get('/client/:clientId', campaignController.getCampaignsByClientId);

// Get campaign data
router.get('/data/:campaignId', campaignController.getCamapignData);
router.get('/videos/:campaignId', campaignController.getCampaignResponseUrls);

router.get('/response/data/:userId', campaignController.getUserDashboardStats);
router.get('/response/campaign/data/:userId', campaignController.getUserCampaignData);

// City map data (BEFORE generic :campaignId routes)
router.get('/:campaignId/citymap', campaignController.getParticipantCityMap);
router.get('/:campaignId/geojson', campaignController.getParticipantGeoJSON);

// Location-based participant filtering (BEFORE generic :campaignId routes)
router.get('/:campaignId/location/stats', campaignController.getParticipantLocationStats);
router.get('/:campaignId/location/filter', campaignController.getParticipantsWithLocationFilters);

// Update campaign (after static path segments above)
router.put('/:campaignId', authenticate, authorize('client', 'admin', 'super_admin'), campaignController.updateCampaign);

// Delete campaign
router.delete('/:campaignId', authenticate, authorize('client', 'admin', 'super_admin'), campaignController.deleteCampaign);

// Get campaign by ID
router.get('/:campaignId', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.campaignId });
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    res.json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
