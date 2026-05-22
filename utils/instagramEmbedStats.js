const axios = require('axios');
const { extractInstagramShortcode } = require('./instagramRapidApi');

const embedCache = new Map();
const EMBED_CACHE_TTL_MS = 10 * 60 * 1000;

function parseCountToken(raw) {
  if (!raw) return 0;
  const s = String(raw).trim().replace(/,/g, '');
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  let n = parseFloat(m[1]);
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') n *= 1000;
  if (suffix === 'M') n *= 1000000;
  if (suffix === 'B') n *= 1000000000;
  return Math.round(n);
}

function parseEmbedCommentCount(html) {
  if (!html) return 0;
  const patterns = [
    /View all\s+([\d,.]+[KMB]?)\s+comments/i,
    />([\d,.]+[KMB]?)\s+comments\s*</i,
    /CaptionComments[\s\S]{0,300}?([\d,.]+[KMB]?)\s+comments/i,
    /([\d,.]+[KMB]?)\s+comments\s*<\/a>/i,
  ];
  let best = 0;
  for (const re of patterns) {
    const flags = re.flags.includes('g') ? re : new RegExp(re.source, re.flags + 'g');
    const matches = [...html.matchAll(flags)];
    for (const m of matches) {
      const n = parseCountToken(m[1]);
      if (n > best) best = n;
    }
  }
  return best;
}

function parseEmbedLikeCount(html) {
  if (!html) return 0;
  const patterns = [
    /([\d,.]+[KMB]?)\s+likes?/i,
    /"like_count"\s*:\s*(\d+)/i,
    /likeCount["\s:>]+([\d,.]+[KMB]?)/i,
    />([\d,.]+[KMB]?)\s*<[^>]*>\s*likes?/i,
  ];
  let best = 0;
  for (const re of patterns) {
    const flags = re.flags.includes('g') ? re : new RegExp(re.source, re.flags + 'g');
    const matches = [...html.matchAll(flags)];
    for (const m of matches) {
      const n = parseCountToken(m[1]);
      if (n > best) best = n;
    }
  }
  return best;
}

function parseEmbedViewCount(html) {
  if (!html) return 0;
  const patterns = [
    /([\d,.]+[KMB]?)\s+(?:views?|plays?)/i,
    /"view_count"\s*:\s*(\d+)/i,
    /"play_count"\s*:\s*(\d+)/i,
    /viewCount["\s:>]+([\d,.]+[KMB]?)/i,
    /playCount["\s:>]+([\d,.]+[KMB]?)/i,
    /video_view_count["\s:>]+(\d+)/i,
  ];
  let best = 0;
  for (const re of patterns) {
    const flags = re.flags.includes('g') ? re : new RegExp(re.source, re.flags + 'g');
    const matches = [...html.matchAll(flags)];
    for (const m of matches) {
      const n = parseCountToken(m[1]);
      if (n > best) best = n;
    }
  }
  return best;
}

async function fetchEmbedHtml(embedUrl) {
  const res = await axios.get(embedUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.instagram.com/',
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Cache-Control': 'no-cache',
    },
    timeout: 25000,
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return typeof res.data === 'string' ? res.data : '';
}

/**
 * Fetch views, likes, comments from Instagram embed page.
 * Works for any public reel — no API key needed.
 */
async function fetchInstagramStatsFromEmbed(url) {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) return { views: 0, likes: 0, comments: 0 };

  const cached = embedCache.get(shortcode);
  if (cached && Date.now() - cached.at < EMBED_CACHE_TTL_MS) {
    return { views: cached.views || 0, likes: cached.likes || 0, comments: cached.comments || 0 };
  }

  const embedUrls = [
    `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/reel/${shortcode}/embed/`,
    `https://www.instagram.com/p/${shortcode}/embed/`,
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    for (const embedUrl of embedUrls) {
      try {
        const html = await fetchEmbedHtml(embedUrl);
        const views = parseEmbedViewCount(html);
        const likes = parseEmbedLikeCount(html);
        const comments = parseEmbedCommentCount(html);
        if (views > 0 || likes > 0 || comments > 0) {
          embedCache.set(shortcode, { views, likes, comments, at: Date.now() });
          return { views, likes, comments };
        }
      } catch (err) {
        console.warn('[instagramEmbedStats]', embedUrl, err.message);
      }
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return { views: 0, likes: 0, comments: 0 };
}

/**
 * Use Facebook oEmbed API to get like_count for any public Instagram post.
 * Requires INSTAGRAM_ACCESS_TOKEN in .env (your app token).
 */
async function fetchInstagramViaOEmbed(url) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const res = await axios.get('https://graph.facebook.com/v21.0/instagram_oembed', {
      params: {
        url,
        fields: 'like_count,comments_count,thumbnail_url,author_name',
        access_token: token,
      },
      timeout: 15000,
    });
    const d = res.data;
    if (!d) return null;
    return {
      likes: parseInt(d.like_count || 0, 10),
      comments: parseInt(d.comments_count || 0, 10),
    };
  } catch (err) {
    console.warn('[instagramEmbedStats] oEmbed:', err.response?.data?.error?.message || err.message);
    return null;
  }
}

// Keep backward-compat export
async function fetchInstagramCommentsFromEmbed(url) {
  const stats = await fetchInstagramStatsFromEmbed(url);
  return stats.comments;
}

/** Optional: SocialKit stats API (returns comments integer). */
async function fetchInstagramCommentsViaSocialKit(url) {
  const key = process.env.SOCIALKIT_ACCESS_KEY;
  if (!key) return 0;
  try {
    const res = await axios.get('https://api.socialkit.dev/instagram/stats', {
      params: { access_key: key, url },
      timeout: 20000,
    });
    const n = parseInt(res.data?.data?.comments ?? res.data?.comments ?? 0, 10);
    return Number.isNaN(n) ? 0 : n;
  } catch (err) {
    console.warn('[instagramEmbedStats] SocialKit:', err.message);
    return 0;
  }
}

module.exports = {
  fetchInstagramCommentsFromEmbed,
  fetchInstagramCommentsViaSocialKit,
  fetchInstagramStatsFromEmbed,
  fetchInstagramViaOEmbed,
  parseEmbedCommentCount,
  parseEmbedLikeCount,
  parseEmbedViewCount,
  parseCountToken,
};
