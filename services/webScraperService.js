const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  console.log('✅ Cloudinary configured');
} else {
  console.log('⚠️ Cloudinary not configured - screenshots will be skipped');
}

class WebScraperService {
  constructor() {
    this.browser = null;
    this.activeSessions = 0;
    this.maxConcurrentSessions = 3;
  }

  async launchBrowser() {
    try {
      // Check concurrent sessions limit
      if (this.activeSessions >= this.maxConcurrentSessions) {
        throw new Error('Maximum concurrent analysis sessions reached. Please try again later.');
      }

      console.log('[Browser] 🚀 Launching browser...');
      // Use a dedicated Chromium profile so DevTools state, extensions, etc. don't interfere
      const profileDir = path.join(__dirname, '../.chromium-profile');
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      const browser = await puppeteer.launch({
        headless: true,
        devtools: false,
        executablePath: '/usr/bin/google-chrome-stable',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-backgrounding-occluded-windows',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          `--user-data-dir=${profileDir}`
        ],
        defaultViewport: { width: 1280, height: 800 },
        timeout: 60000,
        ignoreDefaultArgs: ['--enable-automation']
      });
      
      this.activeSessions++;
      console.log(`[Browser] ✅ Browser launched successfully (Active sessions: ${this.activeSessions})`);
      
      return browser;
    } catch (error) {
      console.error('[Browser] ❌ Failed to launch browser:', error.message);
      throw new Error(`Browser launch failed: ${error.message}`);
    }
  }

  async closeBrowser(browser) {
    if (browser) {
      try {
        await browser.close();
        this.activeSessions = Math.max(0, this.activeSessions - 1);
        console.log(`[Browser] ✅ Browser closed (Active sessions: ${this.activeSessions})`);
      } catch (error) {
        console.error('[Browser] ⚠️ Error closing browser:', error.message);
      }
    }
  }

  async captureScreenshotsDetailed(page, baseFilename) {
    const screenshots = [];
    const details = [];
    const isCloudinaryEnabled = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET;

    const safeVisibleContent = async () => {
      try {
        return await page.evaluate(() => {
          const candidates = Array.from(
            document.querySelectorAll('h1, h2, h3, nav a, header a, button, [role="button"], a')
          );

          const visible = [];
          for (const el of candidates) {
            if (!el) continue;
            const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
            if (!text || text.length < 2) continue;
            const rect = el.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
            if (rect.width < 20 || rect.height < 10) continue;
            visible.push(text.substring(0, 120));
            if (visible.length >= 8) break;
          }
          return visible;
        });
      } catch (_) {
        return [];
      }
    };

    try {
      if (!isCloudinaryEnabled) {
        console.log('[Scraper] ⚠️ Cloudinary not configured - screenshots will be skipped');
        return { screenshots: [], details: [] };
      }

      console.log('[Scraper] 📸 Starting auto-scroll and screenshot capture (Cloudinary)...');

      await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {
        console.log('[Scraper] ⚠️ Network not idle, continuing...');
      });

      await new Promise((resolve) => setTimeout(resolve, 2500));

      const scrollHeight = await page.evaluate(() => document.body.scrollHeight || 0);
      const viewportHeight = await page.evaluate(() => window.innerHeight || 0);

      if (!scrollHeight || !viewportHeight) {
        throw new Error('Failed to get page dimensions');
      }

      const maxScreenshots = 10;
      const scrollStep = Math.max(700, Math.floor(viewportHeight * 1.1));

      let currentPosition = 0;
      let i = 0;

      while (currentPosition < scrollHeight && i < maxScreenshots) {
        await page.evaluate((pos) => window.scrollTo({ top: pos, behavior: 'smooth' }), currentPosition);
        await new Promise((resolve) => setTimeout(resolve, 650));
        await page
          .waitForNetworkIdle({ idleTime: 500, timeout: 5000 })
          .catch(() => null);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => null);

        const screenshotBuffer = await page.screenshot({
          fullPage: false,
          type: 'jpeg',
          quality: 85,
          encoding: 'binary'
        });

        // Upload to Cloudinary
        try {
          const uploadResult = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
              {
                folder: 'website-analyzer/screenshots',
                resource_type: 'image',
                format: 'jpg'
              },
              (error, result) => {
                if (error) reject(error);
                else resolve(result);
              }
            ).end(screenshotBuffer);
          });

          const screenshotPath = uploadResult.secure_url;
          screenshots.push(screenshotPath);
          console.log(`[Scraper] ✅ Screenshot ${i} uploaded to Cloudinary`);

          const percentage = Math.min(
            100,
            Math.max(0, Math.round((currentPosition / Math.max(1, scrollHeight - viewportHeight)) * 100))
          );
          const title = await page.title().catch(() => '');
          const visibleContent = await safeVisibleContent();

          details.push({
            position: i + 1,
            percentage,
            path: screenshotPath,
            title: title || undefined,
            visibleContent
          });
        } catch (cloudinaryError) {
          console.error(`[Scraper] ❌ Cloudinary upload failed for screenshot ${i}:`, cloudinaryError.message);
        }

        currentPosition += scrollStep;
        i++;
      }

      // full page screenshot
      try {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await new Promise((resolve) => setTimeout(resolve, 800));

        const fullScreenshotBuffer = await page.screenshot({
          fullPage: true,
          type: 'jpeg',
          quality: 90,
          encoding: 'binary'
        });

        // Upload to Cloudinary
        try {
          const uploadResult = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
              {
                folder: 'website-analyzer/screenshots',
                resource_type: 'image',
                format: 'jpg'
              },
              (error, result) => {
                if (error) reject(error);
                else resolve(result);
              }
            ).end(fullScreenshotBuffer);
          });

          const fullScreenshotPath = uploadResult.secure_url;
          screenshots.push(fullScreenshotPath);
          console.log('[Scraper] ✅ Full page screenshot uploaded to Cloudinary');

          details.push({
            position: 'full',
            percentage: 100,
            path: fullScreenshotPath,
            title: await page.title().catch(() => '') || undefined,
            visibleContent: ['Full page']
          });
        } catch (cloudinaryError) {
          console.error('[Scraper] ❌ Cloudinary upload failed for full screenshot:', cloudinaryError.message);
        }
      } catch (e) {
        console.error('[Scraper] ⚠️ Full page screenshot failed:', e.message);
      }
    } catch (error) {
      console.error('[Scraper] ❌ Screenshot capture error:', error.message);
    }

    console.log(`[Scraper] 🎯 Total screenshots uploaded to Cloudinary: ${screenshots.length}`);
    return { screenshots, details };
  }

  async captureScreenshots(page, baseFilename) {
    const { screenshots } = await this.captureScreenshotsDetailed(page, baseFilename);
    return screenshots;
  }

  async extractPageData(page, url) {
    console.log('[Scraper] 📊 Extracting page data...');
    
    try {
      const data = await page.evaluate((pageUrl) => {
        try {
          const baseHost = (() => {
            try {
              return new URL(pageUrl).hostname;
            } catch {
              return '';
            }
          })();

          // Page info with null checks
          const title = document.title || 'No title';
          const metaDescription = document.querySelector('meta[name="description"]')?.content || 
                                 document.querySelector('meta[property="og:description"]')?.content || '';
          const metaKeywords = document.querySelector('meta[name="keywords"]')?.content || '';
          const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';
          const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
          const ogDescription = document.querySelector('meta[property="og:description"]')?.content || '';
          const twitterTitle = document.querySelector('meta[name="twitter:title"]')?.content || '';
          const twitterDescription = document.querySelector('meta[name="twitter:description"]')?.content || '';
          const twitterImage = document.querySelector('meta[name="twitter:image"]')?.content || '';
          const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
          const favicons = Array.from(document.querySelectorAll('link[rel*="icon"][href]'))
            .map(l => l.href)
            .filter(Boolean)
            .slice(0, 10);
          
          // Links with validation
          const links = Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'));

          const classifiedLinks = links.map((href) => {
            try {
              const h = new URL(href).hostname;
              return { href, host: h, internal: baseHost ? h === baseHost : false };
            } catch {
              return { href, host: '', internal: false };
            }
          });
          const internalLinks = classifiedLinks.filter(l => l.internal).map(l => l.href);
          const externalLinks = classifiedLinks.filter(l => !l.internal).map(l => l.href);
          const topExternalDomains = Object.entries(
            externalLinks.reduce((acc, href) => {
              try {
                const host = new URL(href).hostname;
                acc[host] = (acc[host] || 0) + 1;
              } catch {}
              return acc;
            }, {})
          )
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([domain, count]) => ({ domain, count }));
          
          const images = Array.from(document.querySelectorAll('img[src]'))
            .map(img => ({
              src: img.src,
              alt: img.alt || '',
              title: img.title || ''
            }))
            .filter(img => img.src && img.src.startsWith('http'));
          
          // Forms with details
          const forms = Array.from(document.querySelectorAll('form')).map(form => ({
            action: form.action || '',
            method: form.method || 'get',
            inputs: form.querySelectorAll('input, textarea, select').length
          }));
          
          // Headings with safety
          const headings = {
            h1: Array.from(document.querySelectorAll('h1')).map(h => h.textContent?.trim() || '').filter(Boolean),
            h2: Array.from(document.querySelectorAll('h2')).map(h => h.textContent?.trim() || '').filter(Boolean),
            h3: Array.from(document.querySelectorAll('h3')).map(h => h.textContent?.trim() || '').filter(Boolean)
          };
          
          // Buttons
          const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a.button'))
            .map(btn => btn.textContent?.trim() || btn.value || '')
            .filter(Boolean);
          
          // Scripts and styles count
          const scriptsCount = document.querySelectorAll('script').length;
          const stylesCount = document.querySelectorAll('link[rel="stylesheet"], style').length;
          const scripts = Array.from(document.querySelectorAll('script[src]'))
            .map(s => s.src)
            .filter(Boolean)
            .slice(0, 80);
          const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))
            .map(l => l.href)
            .filter(Boolean)
            .slice(0, 80);

          const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
            .map(s => s.textContent)
            .filter(Boolean)
            .slice(0, 5)
            .map((raw) => {
              try {
                const parsed = JSON.parse(raw);
                return parsed;
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          
          // Language
          const language = document.documentElement.lang || 
                          document.querySelector('meta[http-equiv="content-language"]')?.content || 
                          'unknown';
          
          // Viewport
          const viewport = document.querySelector('meta[name="viewport"]')?.content || 'not set';
          
          // Full text with safety
          const fullText = (document.body?.innerText || '').substring(0, 15000);
          
          // Word count
          const wordCount = fullText.split(/\s+/).filter(Boolean).length;
          
          return {
            title,
            metaDescription,
            metaKeywords,
            ogImage,
            ogTitle,
            ogDescription,
            twitterTitle,
            twitterDescription,
            twitterImage,
            canonical,
            favicons,
            language,
            viewport,
            linksCount: links.length,
            internalLinksCount: internalLinks.length,
            externalLinksCount: externalLinks.length,
            imagesCount: images.length,
            formsCount: forms.length,
            scriptsCount,
            stylesCount,
            scripts,
            stylesheets,
            structuredData: jsonLd,
            topExternalDomains,
            wordCount,
            headings,
            buttons: buttons.slice(0, 20),
            fullText,
            allLinks: links,
            internalLinks: internalLinks.slice(0, 500),
            externalLinks: externalLinks.slice(0, 500),
            images: images.slice(0, 50),
            forms
          };
        } catch (error) {
          console.error('Page evaluation error:', error);
          return {
            title: 'Error extracting data',
            metaDescription: '',
            metaKeywords: '',
            linksCount: 0,
            imagesCount: 0,
            formsCount: 0,
            headings: { h1: [], h2: [], h3: [] },
            buttons: [],
            fullText: '',
            allLinks: []
          };
        }
      }, url);

      console.log(`[Scraper] ✅ Page data extracted - Title: "${data.title}", Links: ${data.linksCount}, Images: ${data.imagesCount}, Words: ${data.wordCount}`);
      return data;
    } catch (error) {
      console.error('[Scraper] ❌ Page data extraction error:', error.message);
      return {
        title: 'Error',
        metaDescription: '',
        metaKeywords: '',
        linksCount: 0,
        imagesCount: 0,
        formsCount: 0,
        headings: { h1: [], h2: [], h3: [] },
        buttons: [],
        fullText: '',
        allLinks: []
      };
    }
  }

  async extractContactInfo(page) {
    console.log('[Scraper] 📞 Extracting contact information...');
    
    const contactInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      const html = document.body.innerHTML;
      
      // Enhanced Email regex - more comprehensive
      const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
      const emails = [...new Set(text.match(emailRegex) || [])]
        .filter(email => {
          // Filter out common false positives
          const invalid = ['example@', 'test@', 'user@', 'admin@example', '@example.com'];
          return !invalid.some(inv => email.toLowerCase().includes(inv));
        });
      
      // Enhanced Phone regex - international formats
      const phonePatterns = [
        /\+?\d{1,4}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}/g,
        /\(\d{3}\)\s*\d{3}[-\s]?\d{4}/g,
        /\d{3}[-\s]?\d{3}[-\s]?\d{4}/g,
        /\+\d{1,3}\s?\d{6,14}/g
      ];
      
      let phones = [];
      phonePatterns.forEach(pattern => {
        const matches = text.match(pattern) || [];
        phones = phones.concat(matches);
      });
      
      // Clean and deduplicate phones
      phones = [...new Set(phones)]
        .filter(phone => {
          const digits = phone.replace(/\D/g, '');
          return digits.length >= 7 && digits.length <= 15;
        })
        .map(phone => phone.trim());
      
      // WhatsApp - multiple patterns
      const whatsappPatterns = [
        /(?:whatsapp|wa\.me)[:\\/\s]+(\+?[\d\s+-]+)/gi,
        /wa\.me\/([\d]+)/gi,
        /whatsapp.*?(\+?\d[\d\s-]{8,})/gi
      ];
      
      let whatsapp = [];
      whatsappPatterns.forEach(pattern => {
        const matches = [...(text.matchAll(pattern) || [])].map(m => m[0]);
        whatsapp = whatsapp.concat(matches);
      });
      whatsapp = [...new Set(whatsapp)];
      
      // Telegram - enhanced patterns
      const telegramPatterns = [
        /(?:telegram|t\.me)[:\\/\s]+([\w]+)/gi,
        /@([a-zA-Z0-9_]{5,32})/g
      ];
      
      let telegram = [];
      telegramPatterns.forEach(pattern => {
        const matches = [...(text.matchAll(pattern) || [])].map(m => m[0]);
        telegram = telegram.concat(matches);
      });
      telegram = [...new Set(telegram)].filter(t => t.length > 3);
      
      // Extract from href attributes
      const links = Array.from(document.querySelectorAll('a[href]'));
      links.forEach(link => {
        const href = link.href.toLowerCase();
        if (href.includes('mailto:')) {
          const email = href.replace('mailto:', '').split('?')[0];
          if (email && email.includes('@')) emails.push(email);
        }
        if (href.includes('tel:')) {
          const phone = href.replace('tel:', '').trim();
          if (phone) phones.push(phone);
        }
        if (href.includes('wa.me') || href.includes('whatsapp')) {
          whatsapp.push(link.href);
        }
        if (href.includes('t.me') || href.includes('telegram')) {
          telegram.push(link.href);
        }
      });
      
      return { 
        emails: [...new Set(emails)].slice(0, 20),
        phones: [...new Set(phones)].slice(0, 20),
        whatsapp: [...new Set(whatsapp)].slice(0, 10),
        telegram: [...new Set(telegram)].slice(0, 10)
      };
    });

    console.log(`[Scraper] ✅ Contact info extracted - Emails: ${contactInfo.emails.length}, Phones: ${contactInfo.phones.length}`);
    return contactInfo;
  }

  async extractSocialMedia(page) {
    console.log('[Scraper] 🌐 Extracting social media links...');
    
    const socialMedia = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.href);
      
      return {
        facebook: links.filter(l => l.includes('facebook.com')),
        twitter: links.filter(l => l.includes('twitter.com') || l.includes('x.com')),
        instagram: links.filter(l => l.includes('instagram.com')),
        linkedin: links.filter(l => l.includes('linkedin.com')),
        youtube: links.filter(l => l.includes('youtube.com')),
        github: links.filter(l => l.includes('github.com'))
      };
    });

    console.log('[Scraper] ✅ Social media links extracted');
    return socialMedia;
  }

  async detectTechnologies(page) {
    console.log('[Scraper] 🔧 Detecting technologies...');
    
    const technologies = await page.evaluate(() => {
      const techs = [];
      
      // JavaScript Frameworks & Libraries
      if (window.React || document.querySelector('[data-reactroot], [data-reactid]')) techs.push('React');
      if (window.Vue || document.querySelector('[data-v-]')) techs.push('Vue.js');
      if (window.angular || document.querySelector('[ng-app], [ng-version]')) techs.push('Angular');
      if (window.jQuery || window.$) techs.push('jQuery');
      if (window.Ember) techs.push('Ember.js');
      if (window.Backbone) techs.push('Backbone.js');
      if (document.querySelector('[data-svelte]')) techs.push('Svelte');
      if (window.next) techs.push('Next.js');
      if (window.nuxt || window.__NUXT__) techs.push('Nuxt.js');
      if (window.Gatsby || window.___gatsby) techs.push('Gatsby');
      
      // CMS Detection
      const metaGenerator = document.querySelector('meta[name="generator"]')?.content || '';
      if (metaGenerator.toLowerCase().includes('wordpress') || 
          document.body.innerHTML.includes('wp-content') ||
          document.body.innerHTML.includes('wp-includes')) {
        techs.push('WordPress');
      }
      if (window.Shopify || metaGenerator.includes('Shopify')) techs.push('Shopify');
      if (metaGenerator.includes('Drupal')) techs.push('Drupal');
      if (metaGenerator.includes('Joomla')) techs.push('Joomla');
      if (window.Wix || document.body.innerHTML.includes('wix.com')) techs.push('Wix');
      if (document.body.innerHTML.includes('squarespace')) techs.push('Squarespace');
      if (window.Webflow) techs.push('Webflow');
      
      // CSS Frameworks
      if (document.querySelector('link[href*="bootstrap"]') || 
          document.querySelector('[class*="bootstrap"]')) techs.push('Bootstrap');
      if (document.querySelector('script[src*="tailwind"]') ||
          document.querySelector('[class*="tw-"]')) techs.push('Tailwind CSS');
      if (document.querySelector('link[href*="bulma"]')) techs.push('Bulma');
      if (document.querySelector('link[href*="foundation"]')) techs.push('Foundation');
      if (document.querySelector('link[href*="materialize"]')) techs.push('Materialize');
      
      // Icon Libraries
      if (document.querySelector('link[href*="font-awesome"]') ||
          document.querySelector('[class*="fa-"]')) techs.push('Font Awesome');
      if (document.querySelector('link[href*="material-icons"]')) techs.push('Material Icons');
      
      // Analytics & Tracking
      if (window.ga || window.gtag || window.google_tag_manager) techs.push('Google Analytics');
      if (window.fbq) techs.push('Facebook Pixel');
      if (window._hsq) techs.push('HubSpot');
      if (window.mixpanel) techs.push('Mixpanel');
      if (window.analytics) techs.push('Segment');
      if (window.gtm || window.dataLayer) techs.push('Google Tag Manager');
      
      // E-commerce
      if (window.WooCommerce) techs.push('WooCommerce');
      if (window.Magento) techs.push('Magento');
      if (window.PrestaShop) techs.push('PrestaShop');
      
      // CDN & Hosting
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      const links = Array.from(document.querySelectorAll('link[href]'));
      
      scripts.concat(links).forEach(el => {
        const src = el.src || el.href || '';
        if (src.includes('cloudflare')) techs.push('Cloudflare');
        if (src.includes('cdn.jsdelivr')) techs.push('jsDelivr CDN');
        if (src.includes('unpkg.com')) techs.push('unpkg CDN');
        if (src.includes('cdnjs.cloudflare')) techs.push('cdnjs');
        if (src.includes('googleapis.com')) techs.push('Google APIs');
      });
      
      // Payment Gateways
      if (window.Stripe) techs.push('Stripe');
      if (window.PayPal || window.paypal) techs.push('PayPal');
      if (window.Razorpay) techs.push('Razorpay');
      
      // Chat & Support
      if (window.Intercom) techs.push('Intercom');
      if (window.Drift) techs.push('Drift');
      if (window.tidioChatApi) techs.push('Tidio');
      if (window.LiveChatWidget) techs.push('LiveChat');
      if (window.Tawk_API) techs.push('Tawk.to');
      
      // SEO & Marketing
      if (document.querySelector('script[src*="hotjar"]')) techs.push('Hotjar');
      if (window.optimizely) techs.push('Optimizely');
      if (window.Yoast) techs.push('Yoast SEO');
      
      return [...new Set(techs)];
    });

    console.log(`[Scraper] ✅ Technologies detected: ${technologies.length} found - ${technologies.join(', ')}`);
    return technologies;
  }

  async getInternalPages(page, baseUrl) {
    console.log('[Scraper] 🔗 Finding internal pages...');
    
    const internalPages = await page.evaluate((base) => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const baseHost = new URL(base).hostname;
      const basePath = new URL(base).pathname;
      
      const pages = links
        .map(a => {
          try {
            // Handle relative URLs
            let href = a.href;
            if (!href.startsWith('http')) {
              href = new URL(href, base).href;
            }
            return href;
          } catch {
            return null;
          }
        })
        .filter(href => {
          if (!href) return false;
          try {
            const url = new URL(href);
            // Same domain check
            if (url.hostname !== baseHost) return false;
            // Exclude anchors, javascript, and file downloads
            if (href.includes('#') || 
                href.includes('javascript:') ||
                href.match(/\.(pdf|jpg|jpeg|png|gif|svg|zip|rar|doc|docx|xls|xlsx|ppt|pptx)$/i)) {
              return false;
            }
            // Exclude common non-content pages
            const excludePatterns = [
              '/wp-admin', '/wp-login', '/admin', '/login', '/logout',
              '/cart', '/checkout', '/account', '/my-account',
              '/feed', '/rss', '/sitemap', '/robots.txt'
            ];
            if (excludePatterns.some(pattern => url.pathname.includes(pattern))) {
              return false;
            }
            return true;
          } catch {
            return false;
          }
        });
      
      // Deduplicate and prioritize important pages
      const uniquePages = [...new Set(pages)];
      
      // Sort by importance (about, contact, services, products first)
      const priorityKeywords = ['about', 'contact', 'service', 'product', 'portfolio', 'team', 'pricing'];
      const sortedPages = uniquePages.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aScore = priorityKeywords.reduce((score, keyword) => 
          score + (aLower.includes(keyword) ? 1 : 0), 0);
        const bScore = priorityKeywords.reduce((score, keyword) => 
          score + (bLower.includes(keyword) ? 1 : 0), 0);
        return bScore - aScore;
      });
      
      return sortedPages.slice(0, 15); // Increased from 10 to 15
    }, baseUrl);

    console.log(`[Scraper] ✅ Found ${internalPages.length} internal pages`);
    if (internalPages.length > 0) {
      console.log('[Scraper] 📝 Top pages:', internalPages.slice(0, 5).join(', '));
    }
    return internalPages;
  }
}

module.exports = new WebScraperService();
