// Get GeoJSON boundaries for campaign participants
exports.getParticipantGeoJSON = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const geoJsonService = require('../services/geoJsonService');

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const userIds = campaign.userIds || [];
    if (userIds.length === 0) {
      return res.json({
        success: true,
        geojson: { type: 'FeatureCollection', features: [] },
        bounds: null,
        center: null
      });
    }

    const MobileUser = require('../models/MobileUser');
    const users = await MobileUser.find({ googleId: { $in: userIds } }).select('pincode').lean();
    const pincodes = users.map(u => u.pincode).filter(Boolean);

    if (pincodes.length === 0) {
      return res.json({
        success: true,
        geojson: { type: 'FeatureCollection', features: [] },
        bounds: null,
        center: null
      });
    }

    const geojson = await geoJsonService.createFeatureCollection(pincodes);
    const bounds = await geoJsonService.getBoundsForPincodes(pincodes);
    const center = await geoJsonService.getCenterForPincodes(pincodes);

    res.json({
      success: true,
      geojson,
      bounds,
      center,
      pincodeCount: pincodes.length
    });
  } catch (err) {
    console.error('getParticipantGeoJSON:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
