const https = require('https');
const axios = require('axios');

/**
 * Same RapidAPI used by instaReelsDownloaderController (proven in production).
 * NOTE: This is a downloader API — returns video links but NOT view_count reliably.
 */
function fetchInstagramReelFromRapidAPI(reelUrl) {
  return new Promise((resolve, reject) => {
    if (!process.env.RAPIDAPI_KEY) {
      return reject(new Error('RAPIDAPI_KEY not configured'));
    }
    const normalized = normalizeInstagramUrl(reelUrl);
    const encoded = encodeURIComponent(normalized);
    const options = {
      method: 'GET',
      hostname: 'instagram-reels-downloader-api.p.rapidapi.com',
      path: `/download?url=${encoded}`,
      headers: {
        'x-rapidapi-key': process.env.RAPIDAPI_KEY,
        'x-rapidapi-host': 'instagram-reels-downloader-api.p.rapidapi.com',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid RapidAPI response'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('RapidAPI timeout')); });
    req.end();
  });
}

/**
 * Fetch full Instagram post stats (views, likes, comments) using
 * instagram-scraper-api2 on RapidAPI — returns proper engagement metrics.
 * Subscribe at: https://rapidapi.com/social-api1-instagram/api/instagram-scraper-api2
 */
async function fetchInstagramStatsFromRapidAPI(url) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) return null;
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) return null;

  // Try multiple RapidAPI stat endpoints with the same key
  const endpoints = [
    // instagram-scraper-api2 — returns view_count, like_count, comment_count
    // Subscribe (free): https://rapidapi.com/social-api1-instagram/api/instagram-scraper-api2
    {
      url: `https://instagram-scraper-api2.p.rapidapi.com/v1/post_info`,
      params: { code_or_id_or_url: shortcode },
      host: 'instagram-scraper-api2.p.rapidapi.com',
      parse: (d) => ({
        views: toMetric(d?.data?.view_count ?? d?.data?.play_count ?? d?.data?.video_view_count),
        likes: toMetric(d?.data?.like_count ?? d?.data?.likes),
        comments: toMetric(d?.data?.comment_count ?? d?.data?.comments_count),
      }),
    },
    // instagram230 — another popular stats API
    // Subscribe (free): https://rapidapi.com/mrngstar/api/instagram230
    {
      url: `https://instagram230.p.rapidapi.com/post/details`,
      params: { shortcode },
      host: 'instagram230.p.rapidapi.com',
      parse: (d) => ({
        views: toMetric(d?.view_count ?? d?.play_count ?? d?.video_view_count),
        likes: toMetric(d?.like_count ?? d?.likes),
        comments: toMetric(d?.comment_count ?? d?.comments_count),
      }),
    },
    // instagram-bulk-profile-scrapper
    // Subscribe (free): https://rapidapi.com/iq.faceok/api/instagram-bulk-profile-scrapper
    {
      url: `https://instagram-bulk-profile-scrapper.p.rapidapi.com/clients/api/ig/media_by_shortcode`,
      params: { shortcode },
      host: 'instagram-bulk-profile-scrapper.p.rapidapi.com',
      parse: (d) => {
        const item = d?.items?.[0] ?? d?.data ?? d;
        return {
          views: toMetric(item?.view_count ?? item?.play_count ?? item?.video_view_count),
          likes: toMetric(item?.like_count ?? item?.likes?.count),
          comments: toMetric(item?.comment_count ?? item?.comments?.count),
        };
      },
    },
  ];

  for (const ep of endpoints) {
    try {
      const res = await axios.get(ep.url, {
        params: ep.params,
        headers: {
          'x-rapidapi-key': key,
          'x-rapidapi-host': ep.host,
        },
        timeout: 15000,
      });
      const parsed = ep.parse(res.data);
      if (parsed.views > 0 || parsed.likes > 0 || parsed.comments > 0) {
        console.info(`[instagramRapidApi] Stats from ${ep.host}: views=${parsed.views} likes=${parsed.likes} comments=${parsed.comments}`);
        return parsed;
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || '';
      const isQuotaOrSub = /quota|subscri|plan|upgrade/i.test(msg);
      console.warn(`[instagramRapidApi] ${ep.host}:`, msg.slice(0, 120));
      if (isQuotaOrSub) continue; // try next endpoint
    }
  }
  return null;
}

function extractInstagramShortcode(url) {
  if (!url) return null;
  const m = url.match(/instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function normalizeInstagramUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url.trim());
    u.hostname = 'www.instagram.com';
    u.search = '';
    u.hash = '';
    let path = u.pathname.replace(/\/+$/, '');
    if (!path.endsWith('/')) path += '/';
    return `https://www.instagram.com${path}`;
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

/**
 * @returns {{ views, likes, comments, platform, source } | { error }}
 */
function parseInstagramRapidApiResponse(result) {
  const apiError =
    result?.data?.error ||
    result?.message ||
    (result?.success === false ? result?.error : null);
  if (!result?.success || !result?.data || result.data.error) {
    return {
      error: typeof apiError === 'string' ? apiError : 'Instagram reel unavailable or private',
    };
  }
  const d = result.data;
  const views = toMetric(d.view_count ?? d.play_count ?? d.video_view_count);
  const likes = toMetric(d.like_count ?? d.likes);
  const comments = toMetric(d.comment_count ?? d.comments_count ?? d.comments);
  // Only error if ALL metrics are 0 AND there's no engagement data at all
  if (views === 0 && likes === 0 && comments === 0 && !d.like_count && !d.view_count && !d.play_count) {
    return { error: 'RapidAPI returned no engagement metrics for this reel' };
  }
  return {
    views,
    likes,
    comments,
    platform: 'instagram',
    source: 'rapidapi',
  };
}

function toMetric(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : parseInt(String(value).replace(/,/g, ''), 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

module.exports = {
  fetchInstagramReelFromRapidAPI,
  fetchInstagramStatsFromRapidAPI,
  normalizeInstagramUrl,
  parseInstagramRapidApiResponse,
  extractInstagramShortcode,
  toMetric,
};
