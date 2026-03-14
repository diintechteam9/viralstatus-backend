const websiteIntelligenceService = require('../services/websiteIntelligenceService');
const WebsiteAnalysis = require('../models/websiteAnalysis');

// Rate limiting map to prevent duplicate analysis
const analysisCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const activeAnalysis = new Map(); // Track ongoing analysis

const analyzeWebsite = async (req, res) => {
  let url = null;
  
  try {
    url = req.body?.url;
    
    // Validate URL presence
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'URL is required and must be a string'
      });
    }
    
    // Trim and normalize URL
    url = url.trim();
    
    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // Validate URL format
    try {
      const urlObj = new URL(url);
      if (!urlObj.protocol.startsWith('http')) {
        throw new Error('Invalid protocol');
      }
      // Use normalized URL
      url = urlObj.href;
    } catch (urlError) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format. Please provide a valid website URL (e.g., https://example.com)'
      });
    }
    
    const cacheKey = url.toLowerCase();
    
    // Check if analysis is already in progress
    if (activeAnalysis.has(cacheKey)) {
      return res.status(429).json({
        success: false,
        error: 'Analysis already in progress for this URL. Please wait.'
      });
    }
    
    // Check cache
    const cached = analysisCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
      console.log('[Controller] 📦 Returning cached analysis for:', url);
      return res.json(cached.data);
    }
    
    console.log('[Controller] 🚀 Starting new analysis for:', url);
    
    // Mark as active
    activeAnalysis.set(cacheKey, Date.now());
    
    try {
      // Perform analysis with timeout (target ~2–3 minutes)
      const analysisPromise = websiteIntelligenceService.analyzeWebsite(url);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Analysis timeout after 3 minutes')), 3 * 60 * 1000)
      );
      
      const result = await Promise.race([analysisPromise, timeoutPromise]);

      // Provide absolute asset base URL so frontend screenshots never go blank due to env mismatch
      const assetBaseUrl = `${req.protocol}://${req.get('host')}`;
      const withAssets = {
        ...result,
        assetsBaseUrl: assetBaseUrl,
        screenshots: Array.isArray(result.screenshots)
          ? result.screenshots.map((p) =>
              typeof p === 'string' && p.startsWith('/') ? `${assetBaseUrl}${p}` : p
            )
          : result.screenshots,
        screenshotDetails: Array.isArray(result.screenshotDetails)
          ? result.screenshotDetails.map((s) => ({
              ...s,
              path:
                s?.path && String(s.path).startsWith('/')
                  ? `${assetBaseUrl}${s.path}`
                  : s?.path
            }))
          : result.screenshotDetails,
        internalPages: Array.isArray(result.internalPages)
          ? result.internalPages.map((pg) => ({
              ...pg,
              screenshots: Array.isArray(pg.screenshots)
                ? pg.screenshots.map((p) =>
                    typeof p === 'string' && p.startsWith('/')
                      ? `${assetBaseUrl}${p}`
                      : p
                  )
                : pg.screenshots,
              screenshotDetails: Array.isArray(pg.screenshotDetails)
                ? pg.screenshotDetails.map((s) => ({
                    ...s,
                    path:
                      s?.path && String(s.path).startsWith('/')
                        ? `${assetBaseUrl}${s.path}`
                        : s?.path
                  }))
                : pg.screenshotDetails
            }))
          : result.internalPages
      };

      // Persist lightweight snapshot for history tab
      try {
        await WebsiteAnalysis.create({
          url: withAssets.url,
          title: withAssets.pageInfo?.title,
          pageInfo: withAssets.pageInfo,
          contactInfo: withAssets.contactInfo,
          socialMedia: withAssets.socialMedia,
          technologies: withAssets.technologies,
          domainInfo: withAssets.domainInfo,
          dnsRecords: withAssets.dnsRecords,
          serverInfo: withAssets.serverInfo,
          aiAnalysis: withAssets.aiAnalysis,
          totalScreenshots: withAssets.totalScreenshots,
          internalPagesCount: Array.isArray(withAssets.internalPages)
            ? withAssets.internalPages.length
            : 0,
          assetsBaseUrl
        });
      } catch (persistErr) {
        console.error('[Controller] ⚠️ Failed to persist website analysis:', persistErr.message);
      }
      
      // Cache result
      analysisCache.set(cacheKey, {
        data: withAssets,
        timestamp: Date.now()
      });
      
      // Clean old cache entries after 5 minutes
      setTimeout(() => {
        analysisCache.delete(cacheKey);
        console.log('[Controller] 🧹 Cache cleaned for:', url);
      }, CACHE_DURATION);
      
      console.log('[Controller] ✅ Analysis completed successfully for:', url);
      res.json(withAssets);
      
    } finally {
      // Remove from active analysis
      activeAnalysis.delete(cacheKey);
    }
    
  } catch (error) {
    console.error('[Controller] ❌ Error analyzing:', url, error.message);
    
    // Determine appropriate status code
    let statusCode = 500;
    let errorMessage = 'Failed to analyze website';
    
    if (error.message.includes('timeout')) {
      statusCode = 504;
      errorMessage = 'Analysis timeout. The website took too long to respond.';
    } else if (error.message.includes('Maximum concurrent')) {
      statusCode = 429;
      errorMessage = 'Server is busy. Please try again in a few moments.';
    } else if (error.message.includes('Failed to load')) {
      statusCode = 502;
      errorMessage = 'Unable to load the website. Please check the URL and try again.';
    } else if (error.message.includes('Invalid URL')) {
      statusCode = 400;
      errorMessage = error.message;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Cleanup function for graceful shutdown
const cleanup = () => {
  analysisCache.clear();
  activeAnalysis.clear();
  console.log('[Controller] 🧹 Cleanup completed');
};

// List recent analyses for history tab
const listAnalyses = async (req, res) => {
  try {
    const items = await WebsiteAnalysis.find({})
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({
      success: true,
      items: items.map((item) => ({
        id: item._id,
        url: item.url,
        title: item.title,
        createdAt: item.createdAt,
        pageInfo: {
          title: item.pageInfo?.title,
          linksCount: item.pageInfo?.linksCount,
          imagesCount: item.pageInfo?.imagesCount,
          wordCount: item.pageInfo?.wordCount
        },
        aiSummary: {
          executiveSummary: item.aiAnalysis?.executiveSummary,
          trustScore: item.aiAnalysis?.trustScore
        }
      }))
    });
  } catch (error) {
    console.error('[Controller] ❌ listAnalyses error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to load website history'
    });
  }
};

module.exports = {
  analyzeWebsite,
  cleanup,
  listAnalyses
};
