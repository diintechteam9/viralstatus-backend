const axios = require('axios');
const getYoutubeStats = require('./getYoutubeStats');
const {
  fetchInstagramReelFromRapidAPI,
  fetchInstagramStatsFromRapidAPI,
  normalizeInstagramUrl,
  parseInstagramRapidApiResponse,
} = require('./instagramRapidApi');
const {
  fetchInstagramCommentsFromEmbed,
  fetchInstagramCommentsViaSocialKit,
  fetchInstagramStatsFromEmbed,
  fetchInstagramViaOEmbed,
} = require('./instagramEmbedStats');

let cachedIgBusinessAccountId = null;

function extractYoutubeId(url) {
  if (!url) return null;
  let m = url.match(/youtu\.be\/([\w-]{11})/);
  if (m) return m[1];
  m = url.match(/[?&]v=([\w-]{11})/);
  if (m) return m[1];
  m = url.match(/youtube\.com\/shorts\/([\w-]{11})/);
  if (m) return m[1];
  m = url.match(/youtube\.com\/embed\/([\w-]{11})/);
  if (m) return m[1];
  return null;
}

function extractInstagramShortcode(url) {
  if (!url) return null;
  const m = url.match(/instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function detectPlatform(url) {
  if (!url) return 'unknown';
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  return 'unknown';
}

function permalinkMatches(submittedUrl, permalink) {
  const a = normalizeInstagramUrl(submittedUrl).toLowerCase();
  const b = normalizeInstagramUrl(permalink).toLowerCase();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * INSTAGRAM_USER_ID in .env is often a Facebook *user* id (no /media edge).
 * Resolve a real Instagram Business Account id (178414…) from connected pages.
 */
async function resolveInstagramBusinessAccountId(token) {
  if (cachedIgBusinessAccountId) return cachedIgBusinessAccountId;

  const explicit = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (explicit) {
    cachedIgBusinessAccountId = String(explicit);
    return cachedIgBusinessAccountId;
  }

  const configured = process.env.INSTAGRAM_USER_ID;
  if (configured && String(configured).startsWith('178414')) {
    cachedIgBusinessAccountId = String(configured);
    return cachedIgBusinessAccountId;
  }

  try {
    const res = await axios.get('https://graph.facebook.com/v21.0/me/accounts', {
      params: {
        fields: 'id,name,instagram_business_account',
        access_token: token,
        limit: 100,
      },
      timeout: 20000,
    });
    const pages = res.data?.data || [];
    const pageId = process.env.INSTAGRAM_PAGE_ID || process.env.FACEBOOK_PAGE_ID;
    let page = pageId ? pages.find((p) => String(p.id) === String(pageId)) : null;
    if (!page) {
      page = pages.find((p) => p.instagram_business_account?.id);
    }
    const igId = page?.instagram_business_account?.id;
    if (igId) {
      cachedIgBusinessAccountId = String(igId);
      console.info(
        `[socialPostStats] Using Instagram Business Account ${cachedIgBusinessAccountId}` +
          (page?.name ? ` (page: ${page.name})` : '')
      );
      return cachedIgBusinessAccountId;
    }
  } catch (err) {
    console.warn('[socialPostStats] Could not resolve IG business account:', err.response?.data?.error?.message || err.message);
  }

  return null;
}

async function fetchInstagramMediaInsights(mediaId, token) {
  try {
    const res = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}/insights`, {
      params: {
        metric: 'plays,reach,total_interactions,impressions',
        access_token: token,
      },
      timeout: 15000,
    });
    let views = 0;
    for (const ins of res.data?.data || []) {
      if (ins.name === 'plays' || ins.name === 'reach' || ins.name === 'impressions') {
        views = Math.max(views, parseInt(ins.values?.[0]?.value || 0, 10));
      }
    }
    return views;
  } catch (err) {
    console.warn('[socialPostStats] Instagram insights:', err.response?.data?.error?.message || err.message);
    return 0;
  }
}

/** Optional: stats for reels posted on *your* connected business account only. */
async function fetchInstagramViaGraph(url) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return null;

  const igUserId = await resolveInstagramBusinessAccountId(token);
  if (!igUserId) return null;

  try {
    let nextUrl = `https://graph.facebook.com/v21.0/${igUserId}/media`;
    let match = null;

    while (nextUrl && !match) {
      const res = await axios.get(nextUrl, {
        params: nextUrl.includes('?')
          ? undefined
          : {
              fields: 'id,permalink,like_count,comments_count,media_type',
              access_token: token,
              limit: 50,
            },
        timeout: 15000,
      });
      const items = res.data?.data || [];
      match = items.find((m) => permalinkMatches(url, m.permalink));
      nextUrl = !match && res.data?.paging?.next ? res.data.paging.next : null;
    }

    if (!match) return null;

    const views = await fetchInstagramMediaInsights(match.id, token);
    return {
      views,
      likes: parseInt(match.like_count || 0, 10),
      comments: parseInt(match.comments_count || 0, 10),
      source: 'instagram_graph',
    };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.warn('[socialPostStats] Instagram Graph:', msg);
    return null;
  }
}

/**
 * Fetch stats for any public Instagram reel submitted by campaign participants.
 * Priority: Stats RapidAPI → Downloader RapidAPI → Facebook oEmbed → Embed scrape → Graph
 */
async function getInstagramStats(url) {
  const normalized = normalizeInstagramUrl(url);
  let views = 0;
  let likes = 0;
  let comments = 0;
  const sources = [];

  // 1. Dedicated stats RapidAPI — returns view_count, like_count, comment_count properly
  try {
    const statsResult = await fetchInstagramStatsFromRapidAPI(normalized);
    if (statsResult) {
      if (statsResult.views > 0) views = statsResult.views;
      if (statsResult.likes > 0) likes = statsResult.likes;
      if (statsResult.comments > 0) comments = statsResult.comments;
      if (views > 0 || likes > 0 || comments > 0) sources.push('rapidapi_stats');
    }
  } catch (err) {
    console.warn('[socialPostStats] Instagram Stats RapidAPI:', err.message);
  }

  // 2. Downloader RapidAPI — fallback, sometimes has like_count
  if (views === 0 || likes === 0) {
    try {
      const result = await fetchInstagramReelFromRapidAPI(normalized);
      const parsed = parseInstagramRapidApiResponse(result);
      if (!parsed.error) {
        if (views === 0 && parsed.views > 0) views = parsed.views;
        if (likes === 0 && parsed.likes > 0) likes = parsed.likes;
        if (comments === 0 && parsed.comments > 0) comments = parsed.comments;
        sources.push('rapidapi_dl');
      }
    } catch (err) {
      console.warn('[socialPostStats] Instagram Downloader RapidAPI:', err.message);
    }
  }

  // 3. Facebook oEmbed API — uses INSTAGRAM_ACCESS_TOKEN, works for any public post
  if (likes === 0 || comments === 0) {
    try {
      const oembed = await fetchInstagramViaOEmbed(normalized);
      if (oembed) {
        if (likes === 0 && oembed.likes > 0) { likes = oembed.likes; sources.push('oembed_likes'); }
        if (comments === 0 && oembed.comments > 0) { comments = oembed.comments; sources.push('oembed_comments'); }
      }
    } catch (err) {
      console.warn('[socialPostStats] oEmbed:', err.message);
    }
  }

  // 4. Embed HTML scraping — extracts views/likes/comments from public embed page
  if (views === 0 || likes === 0 || comments === 0) {
    try {
      const embedStats = await fetchInstagramStatsFromEmbed(normalized);
      if (views === 0 && embedStats.views > 0) { views = embedStats.views; sources.push('embed_views'); }
      if (likes === 0 && embedStats.likes > 0) { likes = embedStats.likes; sources.push('embed_likes'); }
      if (comments === 0 && embedStats.comments > 0) { comments = embedStats.comments; sources.push('embed_comments'); }
    } catch (err) {
      console.warn('[socialPostStats] Embed scrape:', err.message);
    }
  }

  // 5. SocialKit (if key configured)
  if (comments === 0) {
    const socialKitComments = await fetchInstagramCommentsViaSocialKit(normalized);
    if (socialKitComments > 0) { comments = socialKitComments; sources.push('socialkit'); }
  }

  // 6. Graph API — only works for your own connected business account posts
  if (views === 0 || likes === 0 || comments === 0) {
    const graph = await fetchInstagramViaGraph(normalized);
    if (graph) {
      if (views === 0 && graph.views > 0) { views = graph.views; sources.push('graph_views'); }
      if (likes === 0 && graph.likes > 0) { likes = graph.likes; sources.push('graph_likes'); }
      if (comments === 0 && graph.comments > 0) { comments = graph.comments; sources.push('graph_comments'); }
    }
  }

  if (views > 0 || likes > 0 || comments > 0) {
    return {
      views,
      likes,
      comments,
      platform: 'instagram',
      source: sources.length ? sources.join('+') : 'instagram',
    };
  }

  return {
    views: 0,
    likes: 0,
    comments: 0,
    platform: 'instagram',
    source: 'unavailable',
    error: 'Could not fetch Instagram stats. Ensure the reel is public and RAPIDAPI_KEY / INSTAGRAM_ACCESS_TOKEN are valid.',
  };
}

async function getYoutubePostStats(url) {
  const videoId = extractYoutubeId(url);
  if (!videoId) {
    return { views: 0, likes: 0, comments: 0, platform: 'youtube', error: 'Invalid YouTube URL' };
  }
  if (!process.env.YOUTUBE_API_KEY) {
    return { views: 0, likes: 0, comments: 0, platform: 'youtube', error: 'YOUTUBE_API_KEY missing in .env' };
  }
  const stats = await getYoutubeStats(videoId);
  return {
    views: parseInt(stats.views || 0, 10),
    likes: parseInt(stats.likes || 0, 10),
    comments: parseInt(stats.comments || 0, 10),
    platform: 'youtube',
    source: 'youtube_data_api',
  };
}

async function getPostStats(url) {
  const platform = detectPlatform(url);
  if (platform === 'youtube') return getYoutubePostStats(url);
  if (platform === 'instagram') return getInstagramStats(url);
  return {
    views: 0,
    likes: 0,
    comments: 0,
    platform: 'unknown',
    error: 'Unsupported URL — use YouTube or Instagram reel/post link',
  };
}

module.exports = {
  getPostStats,
  detectPlatform,
  extractYoutubeId,
  extractInstagramShortcode,
  normalizeInstagramUrl,
};
