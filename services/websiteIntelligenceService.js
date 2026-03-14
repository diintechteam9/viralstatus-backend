const axios = require('axios');
const dns = require('dns').promises;
const webScraperService = require('./webScraperService');

class WebsiteIntelligenceService {
  constructor() {
    this.groqApiKey = process.env.GROQ_API_KEY;
    this.openRouterApiKey = process.env.OPENROUTER_API_KEY;
  }

  async analyzeWebsite(url) {
    let browser = null;
    let mainPage = null;
    
    try {
      console.log(`[Intelligence] 🎯 Starting analysis for: ${url}`);
      
      // Validate URL format
      try {
        const urlObj = new URL(url);
        if (!urlObj.protocol.startsWith('http')) {
          throw new Error('URL must start with http:// or https://');
        }
      } catch (urlError) {
        throw new Error(`Invalid URL format: ${urlError.message}`);
      }
      
      // Launch browser
      browser = await webScraperService.launchBrowser();
      mainPage = await browser.newPage();
      const mainTarget = mainPage.target();

      // Auto-close extra tabs/popups opened by website (IndiaMART etc use window.open / target="_blank")
      browser.on('targetcreated', async (target) => {
        if (target.type() === 'page' && target !== mainTarget) {
          try {
            const p = await target.page();
            if (p) await p.close();
          } catch (_) {}
        }
      });

      await mainPage.bringToFront();
      
      // Set user agent to avoid bot detection
      await mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Navigate to URL with retry logic
      console.log('[Intelligence] 🌐 Loading website...');
      let retries = 3;
      let lastError = null;
      
      while (retries > 0) {
        try {
          await mainPage.goto(url, { 
            waitUntil: ['domcontentloaded', 'networkidle2'],
            timeout: 60000 
          });
          await mainPage.bringToFront();
          console.log('[Intelligence] ✅ Website loaded successfully');
          break;
        } catch (gotoError) {
          lastError = gotoError;
          retries--;
          if (retries > 0) {
            console.log(`[Intelligence] ⚠️ Retry loading website (${retries} attempts left)...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      
      if (retries === 0) {
        throw new Error(`Failed to load website after 3 attempts: ${lastError.message}`);
      }
      
      const timestamp = Date.now();
      const baseFilename = `screenshot_${timestamp}`;
      
      // Capture screenshots with auto-scroll
      const { screenshots, details: screenshotDetails } =
        await webScraperService.captureScreenshotsDetailed(mainPage, baseFilename);
      
      // Extract data
      const pageData = await webScraperService.extractPageData(mainPage, url);
      const contactInfo = await webScraperService.extractContactInfo(mainPage);
      const socialMedia = await webScraperService.extractSocialMedia(mainPage);
      const technologies = await webScraperService.detectTechnologies(mainPage);
      
      // Get internal pages
      const internalPages = await webScraperService.getInternalPages(mainPage, url);
      const internalPagesData = [];
      
      // Visit internal pages (limit to 3 for speed) - reuse main page
      const maxInternalPages = Math.min(internalPages.length, 3);
      console.log(`[Intelligence] 📚 Planning to visit ${maxInternalPages} internal pages`);
      
      for (let i = 0; i < maxInternalPages; i++) {
        try {
          console.log(`[Intelligence] 📄 Visiting internal page ${i + 1}/${maxInternalPages}: ${internalPages[i]}`);
          
          // Reuse same tab - navigate to internal page
          await mainPage.goto(internalPages[i], { 
            waitUntil: ['domcontentloaded', 'networkidle2'], 
            timeout: 45000 
          });
          await mainPage.bringToFront();
          
          console.log(`[Intelligence] ✅ Page loaded, capturing screenshots...`);
          
          const { screenshots: internalScreenshots, details: internalScreenshotDetails } =
            await webScraperService.captureScreenshotsDetailed(
              mainPage,
              `internal_${i}_${timestamp}`
            );
          
          const internalData = await webScraperService.extractPageData(mainPage, internalPages[i]);
          
          internalPagesData.push({
            url: internalPages[i],
            title: internalData.title,
            screenshots: internalScreenshots,
            screenshotDetails: internalScreenshotDetails,
            linksCount: internalData.linksCount,
            imagesCount: internalData.imagesCount
          });
          
          console.log(`[Intelligence] ✅ Internal page ${i + 1} completed - ${internalScreenshots.length} screenshots`);
          
        } catch (error) {
          console.error(`[Intelligence] ❌ Error visiting internal page ${i + 1}: ${error.message}`);
        }
      }
      
      // Get domain info
      const domain = new URL(url).hostname;
      const domainInfo = await this.getDomainInfo(domain);
      const dnsRecords = await this.getDNSRecords(domain);
      
      // Get server info from already loaded page response
      let serverInfo = {};
      try {
        // Navigate back to main URL to get fresh headers
        const response = await mainPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await mainPage.bringToFront();
        serverInfo = this.extractServerInfo(response);
      } catch (serverError) {
        console.error('[Intelligence] ⚠️ Server info extraction failed:', serverError.message);
        serverInfo = { error: serverError.message };
      }
      
      // Close main page
      if (mainPage) {
        await mainPage.close();
      }
      
      // AI Analysis
      const aiAnalysis = await this.getAIAnalysis({
        url,
        pageData,
        contactInfo,
        socialMedia,
        technologies,
        domainInfo,
        dnsRecords,
        serverInfo,
        internalPages: internalPagesData,
        mainPageScreenshotsCount: screenshots.length
      });
      
      // Close browser
      await webScraperService.closeBrowser(browser);
      
      console.log('[Intelligence] ✅ Analysis completed successfully');
      
      return {
        success: true,
        url,
        pageInfo: pageData,
        screenshots,
        screenshotDetails,
        internalPages: internalPagesData,
        contactInfo,
        socialMedia,
        technologies,
        domainInfo,
        dnsRecords,
        serverInfo,
        aiAnalysis,
        totalScreenshots: screenshots.length + internalPagesData.reduce((acc, p) => acc + p.screenshots.length, 0),
        analyzedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('[Intelligence] ❌ Analysis error:', error);
      
      // Ensure all pages are closed
      if (mainPage) {
        try {
          await mainPage.close();
        } catch (e) {
          // Ignore
        }
      }
      
      // Ensure browser is closed
      if (browser) {
        await webScraperService.closeBrowser(browser);
      }
      
      throw error;
    }
  }

  async getDomainInfo(domain) {
    try {
      console.log('[Intelligence] 🔍 Fetching domain info (WHOIS)...');
      const normalizedDomain = String(domain || '')
        .trim()
        .toLowerCase()
        .replace(/^www\./, '');
      const whois = require('whois-json');
      const raw = await whois(normalizedDomain, { follow: 2 }).catch(() => null);

      if (!raw || typeof raw !== 'object') {
        console.log('[Intelligence] ⚠️ WHOIS unavailable, returning basic info');
        return {
          domain: normalizedDomain || domain,
          registrar: 'N/A',
          createdDate: 'N/A',
          expiryDate: 'N/A',
          updatedDate: 'N/A',
          nameServers: [],
          registrant: {
            name: 'N/A',
            organization: 'N/A',
            email: 'N/A',
            phone: 'N/A',
            country: 'N/A'
          }
        };
      }

      const arr = (v) => (Array.isArray(v) ? v : v != null ? [String(v)] : []);
      const str = (v) => (v != null ? String(v).trim() : 'N/A');
      const cleanDate = (v) => {
        const s = str(v);
        if (s === 'N/A') return 'N/A';
        // Some WHOIS servers return a default min date; treat as missing
        if (s.startsWith('0001-01-01')) return 'N/A';
        return s;
      };
      const nameServers = [
        ...arr(raw.nameServer),
        ...arr(raw.nameServers)
      ]
        .flatMap((s) => String(s || '').split(/\s+/g))
        .map((s) => s.trim())
        .filter(Boolean);

      const info = {
        domain: str(raw.domainName) !== 'N/A' ? str(raw.domainName) : (normalizedDomain || domain),
        registrar: str(raw.registrar || raw.registrarName),
        createdDate: cleanDate(raw.creationDate || raw.createdDate),
        expiryDate: cleanDate(raw.registrarRegistrationExpirationDate || raw.expiryDate || raw.expirationDate),
        updatedDate: cleanDate(raw.updatedDate || raw.lastUpdated),
        nameServers: nameServers.length ? nameServers : ['N/A'],
        registrant: {
          name: str(raw.registrantName || raw.registrant?.name),
          organization: str(raw.registrantOrganization || raw.registrant?.organization),
          email: str(raw.registrantEmail || raw.registrant?.email),
          phone: str(raw.registrantPhone || raw.registrant?.phone),
          country: str(raw.registrantCountry || raw.registrant?.country)
        }
      };

      console.log('[Intelligence] ✅ Domain info fetched');
      return info;
    } catch (error) {
      console.error('[Intelligence] ❌ Domain info error:', error.message);
      return {
        domain,
        registrar: 'N/A',
        createdDate: 'N/A',
        expiryDate: 'N/A',
        updatedDate: 'N/A',
        nameServers: [],
        registrant: {
          name: 'N/A',
          organization: 'N/A',
          email: 'N/A',
          phone: 'N/A',
          country: 'N/A'
        },
        error: error.message
      };
    }
  }

  async getDNSRecords(domain) {
    try {
      console.log('[Intelligence] 🌐 Fetching DNS records...');
      
      const records = {};
      
      try {
        records.A = await dns.resolve4(domain);
      } catch (e) {
        records.A = [];
      }
      
      try {
        records.AAAA = await dns.resolve6(domain);
      } catch (e) {
        records.AAAA = [];
      }
      
      try {
        records.MX = await dns.resolveMx(domain);
      } catch (e) {
        records.MX = [];
      }
      
      try {
        records.NS = await dns.resolveNs(domain);
      } catch (e) {
        records.NS = [];
      }
      
      try {
        records.TXT = await dns.resolveTxt(domain);
      } catch (e) {
        records.TXT = [];
      }
      
      console.log('[Intelligence] ✅ DNS records fetched');
      return records;
    } catch (error) {
      console.error('[Intelligence] ❌ DNS error:', error.message);
      return { error: error.message };
    }
  }

  extractServerInfo(response) {
    try {
      const headers = response.headers();
      return {
        server: headers['server'] || 'Unknown',
        poweredBy: headers['x-powered-by'] || 'Unknown',
        contentType: headers['content-type'] || 'Unknown',
        cacheControl: headers['cache-control'] || 'Unknown',
        securityHeaders: {
          strictTransportSecurity: headers['strict-transport-security'] || 'Not set',
          contentSecurityPolicy: headers['content-security-policy'] || 'Not set',
          xFrameOptions: headers['x-frame-options'] || 'Not set',
          xContentTypeOptions: headers['x-content-type-options'] || 'Not set'
        }
      };
    } catch (error) {
      console.error('[Intelligence] ❌ Server info error:', error.message);
      return { error: error.message };
    }
  }

  async getAIAnalysis(data) {
    try {
      console.log('[Intelligence] 🤖 Starting AI analysis...');
      
      if (!data || !data.pageData) {
        throw new Error('Invalid data for AI analysis');
      }

      const totalScreenshots = (data.mainPageScreenshotsCount || 0) + (data.internalPages?.reduce((acc, p) => acc + (p.screenshots?.length || 0), 0) || 0);
      
      const prompt = `You are an OSINT and website intelligence analyst. Analyze this website comprehensively and respond with ONLY a single valid JSON object (no markdown, no code fences, no extra text).

Website: ${data.pageData.title || 'Unknown'}
URL: ${data.url}

Page Metrics:
- Total Links: ${data.pageData.linksCount || 0}
- Total Images: ${data.pageData.imagesCount || 0}
- Forms: ${data.pageData.formsCount || 0}
- Screenshots Captured: ${totalScreenshots}
- Internal pages analyzed: ${data.internalPages?.length || 0}

Contact Information:
- Emails: ${(data.contactInfo?.emails || []).join(', ') || 'None found'}
- Phones: ${(data.contactInfo?.phones || []).join(', ') || 'None found'}
- WhatsApp: ${(data.contactInfo?.whatsapp || []).join(', ') || 'None found'}
- Telegram: ${(data.contactInfo?.telegram || []).join(', ') || 'None found'}

Social Media:
- Facebook: ${(data.socialMedia?.facebook || []).length} links
- Twitter/X: ${(data.socialMedia?.twitter || []).length} links
- Instagram: ${(data.socialMedia?.instagram || []).length} links
- LinkedIn: ${(data.socialMedia?.linkedin || []).length} links
- YouTube: ${(data.socialMedia?.youtube || []).length} links
- GitHub: ${(data.socialMedia?.github || []).length} links

Technologies Detected: ${(data.technologies || []).join(', ') || 'None detected'}

Domain Information (WHOIS):
- Domain: ${data.domainInfo?.domain || 'Unknown'}
- Registrar: ${data.domainInfo?.registrar || 'N/A'}
- Created: ${data.domainInfo?.createdDate || 'N/A'}
- Expiry: ${data.domainInfo?.expiryDate || 'N/A'}
- Registrant: ${data.domainInfo?.registrant?.name || 'N/A'}, ${data.domainInfo?.registrant?.organization || 'N/A'}, ${data.domainInfo?.registrant?.country || 'N/A'}

DNS: A=${(data.dnsRecords?.A || []).length}, AAAA=${(data.dnsRecords?.AAAA || []).length}, MX=${(data.dnsRecords?.MX || []).length}, NS=${(data.dnsRecords?.NS || []).length}

Server Information:
- Server: ${data.serverInfo?.server || 'Unknown'}
- Powered By: ${data.serverInfo?.poweredBy || 'Unknown'}
- Security headers: ${data.serverInfo?.securityHeaders ? 'Present' : 'Not detailed'}

Content Preview (first 3000 chars):
${(data.pageData.fullText || '').substring(0, 3000)}

Respond with exactly this JSON structure (use empty arrays [] or "N/A" where no value):
{
  "executiveSummary": "Brief overview of the website and its purpose",
  "websiteDetails": {
    "purpose": "Main purpose of the site",
    "businessType": "Type of business",
    "industry": "Industry sector"
  },
  "keyFeatures": ["feature1", "feature2", "feature3"],
  "contentAnalysis": {
    "quality": "Assessment of content quality",
    "professionalism": "Rating or description of professionalism"
  },
  "trustScore": "Score out of 10 (e.g. 7 or 8/10)",
  "technicalAssessment": "Technical evaluation of stack, performance, security",
  "domainAnalysis": "Insights from WHOIS/DNS: registrar, age, registrant, red flags",
  "businessIntelligence": "Business and competitive insights",
  "redFlags": ["flag1", "flag2"] or [],
  "osintValue": "How useful this site is for OSINT and what kind of intelligence can be gathered",
  "recommendations": ["rec1", "rec2"] or [],
  "overallAssessment": "Final assessment and conclusion"
}`;

      let analysis = null;
      
      // Try Groq first
      if (this.groqApiKey && this.groqApiKey !== 'your_groq_api_key_here') {
        try {
          console.log('[Intelligence] 🔑 Using Groq API...');
          const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
              model: 'llama-3.3-70b-versatile',
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.2,
              max_tokens: 4096
            },
            {
              headers: {
                'Authorization': `Bearer ${this.groqApiKey}`,
                'Content-Type': 'application/json'
              },
              timeout: 30000 // 30 second timeout
            }
          );
          
          if (response.data && response.data.choices && response.data.choices[0]) {
            const content = response.data.choices[0].message.content;
            // Remove markdown code blocks and extra text before/after JSON
            let cleanContent = content.trim();
            
            // Find JSON object boundaries
            const jsonStart = cleanContent.indexOf('{');
            const jsonEnd = cleanContent.lastIndexOf('}');
            
            if (jsonStart !== -1 && jsonEnd !== -1) {
              cleanContent = cleanContent.substring(jsonStart, jsonEnd + 1);
            }
            
            analysis = JSON.parse(cleanContent);
            console.log('[Intelligence] ✅ AI analysis completed (Groq)');
          }
        } catch (error) {
          console.error('[Intelligence] ⚠️ Groq API error:', error.response?.data || error.message);
        }
      } else {
        console.log('[Intelligence] ⚠️ Groq API key not configured');
      }
      
      // Fallback to OpenRouter
      if (!analysis && this.openRouterApiKey && this.openRouterApiKey !== 'your_openrouter_key') {
        try {
          console.log('[Intelligence] 🔑 Using OpenRouter API (fallback)...');
          const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
              model: 'anthropic/claude-3-haiku',
              messages: [{ role: 'user', content: prompt }]
            },
            {
              headers: {
                'Authorization': `Bearer ${this.openRouterApiKey}`,
                'Content-Type': 'application/json'
              },
              timeout: 30000
            }
          );
          
          if (response.data && response.data.choices && response.data.choices[0]) {
            const content = response.data.choices[0].message.content;
            // Remove markdown code blocks and extra text before/after JSON
            let cleanContent = content.trim();
            
            // Find JSON object boundaries
            const jsonStart = cleanContent.indexOf('{');
            const jsonEnd = cleanContent.lastIndexOf('}');
            
            if (jsonStart !== -1 && jsonEnd !== -1) {
              cleanContent = cleanContent.substring(jsonStart, jsonEnd + 1);
            }
            
            analysis = JSON.parse(cleanContent);
            console.log('[Intelligence] ✅ AI analysis completed (OpenRouter)');
          }
        } catch (error) {
          console.error('[Intelligence] ⚠️ OpenRouter API error:', error.response?.data || error.message);
        }
      }
      
      // Return default analysis if both APIs failed
      if (!analysis) {
        console.log('[Intelligence] ⚠️ Using default analysis (no AI API available)');
        return {
          executiveSummary: 'AI analysis unavailable. Please configure GROQ_API_KEY or OPENROUTER_API_KEY in your .env file.',
          websiteDetails: {
            purpose: 'Unable to determine',
            businessType: 'Unable to determine',
            industry: 'Unable to determine'
          },
          keyFeatures: [],
          contentAnalysis: {
            quality: 'Not analyzed',
            professionalism: 'Not analyzed'
          },
          trustScore: 'N/A',
          technicalAssessment: 'AI analysis requires API key configuration',
          domainAnalysis: 'Not available',
          businessIntelligence: 'Not available',
          redFlags: [],
          osintValue: 'Configure AI for OSINT insights',
          recommendations: ['Configure GROQ_API_KEY or OPENROUTER_API_KEY for detailed analysis. Get free Groq key at: https://console.groq.com'],
          overallAssessment: 'Manual review recommended',
          note: 'Get free Groq API key at: https://console.groq.com'
        };
      }
      
      return analysis;
      
    } catch (error) {
      console.error('[Intelligence] ❌ AI analysis error:', error.message);
      return { 
        error: error.message,
        executiveSummary: 'AI analysis failed',
        note: 'Please check your API configuration'
      };
    }
  }
}

module.exports = new WebsiteIntelligenceService();
