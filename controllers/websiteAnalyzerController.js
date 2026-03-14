const { URL } = require('url');
const path = require('path');
const websiteIntelligenceService = require('../services/websiteIntelligenceService');
const WebsiteAnalysis = require('../models/websiteAnalysis');

// Main website analyzer function
exports.analyzeWebsite = async (req, res) => {
  try {
    let { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL is required'
      });
    }

    url = String(url).trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    // Validate URL (normalize)
    try {
      url = new URL(url).href;
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format'
      });
    }

    console.log(`[WebsiteAnalyzer] 🚀 Starting deep analysis for: ${url}`);
    const result = await websiteIntelligenceService.analyzeWebsite(url);

    // Flatten social links into a single array (DigitalTrace UI expects array)
    const socialArray = [];
    if (result.socialMedia && typeof result.socialMedia === 'object') {
      Object.values(result.socialMedia).forEach((arr) => {
        if (Array.isArray(arr)) socialArray.push(...arr);
      });
    }
    const socialMedia = [...new Set(socialArray)].slice(0, 60);

    const screenshots =
      (Array.isArray(result.screenshotDetails) && result.screenshotDetails.length > 0)
        ? result.screenshotDetails.map((s) => ({
            position: s.position,
            percentage: s.percentage,
            path: s.path,
            visibleContent: Array.isArray(s.visibleContent) ? s.visibleContent : []
          }))
        : (result.screenshots || []).map((p, idx) => ({
            position: idx + 1,
            percentage: Math.round(((idx + 1) / Math.max(1, (result.screenshots || []).length)) * 100),
            path: p,
            visibleContent: []
          }));

    const ai = result.aiAnalysis || {};
    const businessType = ai.websiteDetails?.businessType || ai.businessType || 'N/A';
    const trustScore = ai.trustScore || 'N/A';

    // Save to database for history
    try {
      await WebsiteAnalysis.create({
        url: result.url || url,
        title: result.pageInfo?.title || 'No title',
        pageInfo: result.pageInfo || {},
        contactInfo: result.contactInfo || {},
        socialMedia: result.socialMedia || {},
        technologies: result.technologies || [],
        domainInfo: result.domainInfo || {},
        dnsRecords: result.dnsRecords || {},
        serverInfo: result.serverInfo || {},
        aiAnalysis: ai,
        totalScreenshots: screenshots.length,
        internalPagesCount: (result.internalPages || []).length,
        assetsBaseUrl: process.env.BACKEND_URL || 'http://localhost:5000',
        // Store complete data for history
        screenshots: screenshots,
        internalPages: (result.internalPages || []).map((p) => ({
          url: p.url,
          title: p.title,
          linksCount: p.linksCount,
          imagesCount: p.imagesCount,
          screenshots: (p.screenshotDetails || []).slice(0, 6)
        })),
        basicInfo: {
          title: result.pageInfo?.title || 'No title',
          url: result.url || url,
          description: result.pageInfo?.metaDescription || 'No description',
          links: result.pageInfo?.linksCount || 0,
          images: result.pageInfo?.imagesCount || 0
        }
      });
      console.log('[WebsiteAnalyzer] ✅ Analysis saved to database');
    } catch (dbError) {
      console.error('[WebsiteAnalyzer] ⚠️ Failed to save to database:', dbError.message);
    }

    // Send response
    res.json({
      success: true,
      data: {
        basicInfo: {
          title: result.pageInfo?.title || 'No title',
          url: result.url || url,
          description: result.pageInfo?.metaDescription || 'No description',
          links: result.pageInfo?.linksCount || 0,
          images: result.pageInfo?.imagesCount || 0
        },
        screenshots,
        contactInfo: {
          emails: result.contactInfo?.emails || [],
          phones: result.contactInfo?.phones || []
        },
        socialMedia,
        technologies: result.technologies || [],
        domainInfo: {
          domain: result.domainInfo?.domain || new URL(url).hostname,
          registrar: result.domainInfo?.registrar || 'Unknown',
          created: result.domainInfo?.createdDate || 'Unknown',
          expires: result.domainInfo?.expiryDate || 'Unknown',
          updated: result.domainInfo?.updatedDate || 'Unknown',
          country: result.domainInfo?.registrant?.country || 'Unknown',
          nameServers: result.domainInfo?.nameServers || []
        },
        internalPages: (result.internalPages || []).map((p) => ({
          url: p.url,
          title: p.title,
          linksCount: p.linksCount,
          imagesCount: p.imagesCount,
          screenshots: (p.screenshotDetails || []).slice(0, 6)
        })),
        contentPreview: (result.pageInfo?.fullText || '').substring(0, 5000),
        dnsRecords: result.dnsRecords || {},
        serverInfo: result.serverInfo || {},
        aiAnalysis: {
          executiveSummary: ai.executiveSummary || 'N/A',
          businessType,
          trustScore,
          raw: ai
        }
      }
    });

  } catch (error) {
    console.error('Website analysis error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to analyze website',
      error: error.message
    });
  }
};

// Get screenshot
exports.getScreenshot = async (req, res) => {
  try {
    const { filename } = req.params;
    const screenshotPath = path.join(__dirname, '../uploads/screenshots', filename);
    
    res.sendFile(screenshotPath);
  } catch (error) {
    console.error('Error serving screenshot:', error);
    res.status(404).json({
      success: false,
      message: 'Screenshot not found'
    });
  }
};

// Get analysis history
exports.getHistory = async (req, res) => {
  try {
    const analyses = await WebsiteAnalysis.find()
      .sort({ createdAt: -1 })
      .limit(50);

    const items = analyses.map(analysis => ({
      id: analysis._id,
      url: analysis.url,
      title: analysis.title || 'Untitled',
      createdAt: analysis.createdAt,
      // Complete data for detailed view
      basicInfo: analysis.basicInfo || {
        title: analysis.title,
        url: analysis.url,
        description: analysis.pageInfo?.metaDescription || 'N/A',
        links: analysis.pageInfo?.linksCount || 0,
        images: analysis.pageInfo?.imagesCount || 0
      },
      screenshots: analysis.screenshots || [],
      contactInfo: analysis.contactInfo || {},
      socialMedia: analysis.socialMedia || {},
      technologies: analysis.technologies || [],
      domainInfo: analysis.domainInfo || {},
      dnsRecords: analysis.dnsRecords || {},
      serverInfo: analysis.serverInfo || {},
      internalPages: analysis.internalPages || [],
      aiAnalysis: analysis.aiAnalysis || {},
      assetsBaseUrl: analysis.assetsBaseUrl || process.env.BACKEND_URL || 'http://localhost:5000',
      pageInfo: {
        linksCount: analysis.pageInfo?.linksCount || 0,
        imagesCount: analysis.pageInfo?.imagesCount || 0,
        wordCount: analysis.pageInfo?.wordCount || 0
      },
      aiSummary: {
        executiveSummary: analysis.aiAnalysis?.executiveSummary || 'N/A',
        trustScore: analysis.aiAnalysis?.trustScore || 'N/A'
      }
    }));

    res.json({
      success: true,
      items
    });
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history'
    });
  }
};

// Delete history item
exports.deleteHistory = async (req, res) => {
  try {
    const { id } = req.params;
    
    const deleted = await WebsiteAnalysis.findByIdAndDelete(id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'History item not found'
      });
    }

    console.log(`[WebsiteAnalyzer] 🗑️ Deleted history item: ${id}`);
    
    res.json({
      success: true,
      message: 'History item deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete history item'
    });
  }
};
