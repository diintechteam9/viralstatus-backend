const mongoose = require('mongoose');

const WebsiteAnalysisSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, index: true },
    title: { type: String },
    pageInfo: { type: Object },
    contactInfo: { type: Object },
    socialMedia: { type: Object },
    technologies: { type: [String], default: [] },
    domainInfo: { type: Object },
    dnsRecords: { type: Object },
    serverInfo: { type: Object },
    aiAnalysis: { type: Object },
    totalScreenshots: { type: Number },
    internalPagesCount: { type: Number },
    assetsBaseUrl: { type: String },
    // Complete data for history
    screenshots: { type: Array, default: [] },
    internalPages: { type: Array, default: [] },
    basicInfo: { type: Object }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
  }
);

module.exports = mongoose.model('WebsiteAnalysis', WebsiteAnalysisSchema);

