const axios = require('axios');

const PLATFORM_LABELS = {
  instagram: 'Instagram', youtube: 'YouTube', twitter: 'Twitter/X', x: 'X (Twitter)',
  facebook: 'Facebook', reddit: 'Reddit', quora: 'Quora', telegram: 'Telegram',
  news: 'News', blog: 'Blog', reviews: 'Reviews', forum: 'Forums',
  articles: 'Articles', post: 'Posts', comment: 'Comments', trend: 'Trends',
};

/** Parse "1.2M", "18K", "About 18,000 results", raw numbers */
const parseMetricNumber = (raw) => {
  if (raw == null || raw === '' || raw === 'N/A') return 0;
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  const s = String(raw).replace(/,/g, '').trim();
  const m = s.match(/([\d.]+)\s*([KMB])?/i);
  if (!m) {
    const digits = s.replace(/[^\d.]/g, '');
    const n = parseFloat(digits);
    return Number.isNaN(n) ? 0 : n;
  }
  let n = parseFloat(m[1]);
  if (Number.isNaN(n)) return 0;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') n *= 1000;
  else if (suffix === 'M') n *= 1_000_000;
  else if (suffix === 'B') n *= 1_000_000_000;
  return Math.round(n);
};

const parseSerpTotalResults = (val) => {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  return parseMetricNumber(val);
};

const formatCount = (n) => {
  const num = typeof n === 'string' ? parseMetricNumber(n) : Number(n);
  if (!num || Number.isNaN(num)) return 'N/A';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 10_000) return `${Math.round(num / 1000)}K`;
  if (num >= 1_000) return `${(num / 1000).toFixed(1)}K`;
  return String(Math.round(num));
};

const isInstagramUsername = (keyword) => /^@?[a-zA-Z0-9._]{2,30}$/.test(String(keyword || '').replace(/^@/, '').trim());

const IG_PATH_SKIP = new Set([
  'p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'tv', 'about', 'legal',
]);

const extractInstagramHandleFromUrl = (url) => {
  if (!url) return null;
  const m = String(url).match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  if (!m) return null;
  const handle = m[1].toLowerCase();
  if (IG_PATH_SKIP.has(handle)) return null;
  return handle;
};

const brandKeywordBase = (keyword) =>
  String(keyword || '').replace(/^@/, '').trim().toLowerCase().replace(/\s+/g, '');

const isExactBrandKeyword = (keyword, handle) => {
  const base = brandKeywordBase(keyword);
  return base.length >= 2 && handle.toLowerCase() === base;
};

const scoreInstagramHandle = (handle, keyword, mentionCount = 0) => {
  const base = brandKeywordBase(keyword);
  const h = handle.toLowerCase();
  let score = mentionCount * 10;
  if (base && h.includes(base)) score += 12;
  if (h === `${base}team` || h === `${base}official`) score += 25;
  if (h.endsWith('team') || h.endsWith('official')) score += 10;
  if (h.length > base.length && h.startsWith(base)) score += 8;
  // Bare "aitota" often a personal account; prefer aitotateam when searching brand "Aitota"
  if (isExactBrandKeyword(keyword, h) && base.length >= 4) score -= 6;
  return score;
};

const countHandleMentions = (organic) => {
  const counts = {};
  for (const r of organic || []) {
    const h = extractInstagramHandleFromUrl(r.link);
    if (h) counts[h] = (counts[h] || 0) + 1;
    const blob = `${r.title || ''} ${r.snippet || ''}`;
    (blob.match(/@([a-zA-Z0-9._]{2,30})/g) || []).forEach((tag) => {
      const u = tag.slice(1).toLowerCase();
      if (isValidInstagramHandle(u)) counts[u] = (counts[u] || 0) + 1;
    });
  }
  return counts;
};

const rankBrandHandles = (handles, keyword, mentionCounts) => {
  const unique = [...new Set(handles.filter(isValidInstagramHandle))];
  return unique.sort(
    (a, b) =>
      scoreInstagramHandle(b, keyword, mentionCounts[b] || 0) -
      scoreInstagramHandle(a, keyword, mentionCounts[a] || 0)
  );
};

const isValidInstagramHandle = (handle) => {
  const h = String(handle || '').toLowerCase().trim();
  if (h.length < 2 || h.length > 30) return false;
  if (!/^[a-z0-9][a-z0-9._]*[a-z0-9]$/.test(h) && !/^[a-z0-9]{2,}$/.test(h)) return false;
  if (/^[._]|[._]$|\.\.|__/.test(h)) return false;
  return true;
};

const brandHandleCandidates = (keyword) => {
  const base = brandKeywordBase(keyword);
  if (!base || base.length < 2) return [];
  // Brand variants BEFORE bare handle (avoids wrong personal @aitota for brand "Aitota")
  const variants = [
    `${base}team`,
    `${base}official`,
    `${base}india`,
    `${base}hq`,
    `${base}global`,
    base,
  ];
  return [...new Set(variants.filter(isValidInstagramHandle))];
};

/** Find likely @handle for a brand (e.g. Aitota → aitotateam) via Google + result URLs */
const discoverInstagramHandles = async (keyword) => {
  const data = await serpSearch({
    engine: 'google',
    q: `${keyword} site:instagram.com`,
    gl: 'in',
    hl: 'en',
    num: 10,
  });
  const counts = {};
  const bump = (handle, weight = 1) => {
    if (!isValidInstagramHandle(handle)) return;
    counts[handle] = (counts[handle] || 0) + weight;
  };

  for (const r of data.organic_results || []) {
    bump(extractInstagramHandleFromUrl(r.link), 3);
    const blob = `${r.title || ''} ${r.snippet || ''} ${r.source || ''}`;
    const atMatches = blob.match(/@([a-zA-Z0-9._]{2,30})/g) || [];
    atMatches.forEach((tag) => {
      const h = tag.slice(1).toLowerCase();
      if (isValidInstagramHandle(h)) bump(h, 2);
    });
  }

  return Object.keys(counts).sort(
    (a, b) => scoreInstagramHandle(b, keyword, counts[b]) - scoreInstagramHandle(a, keyword, counts[a])
  );
};

const mergeProfileIntoSerpResult = (serpResult, profile) => ({
  ...serpResult,
  source: profile.source || serpResult.source,
  profileUsername: profile.profileUsername,
  totalFollowers: profile.totalFollowers || serpResult.totalFollowers,
  totalPosts: profile.totalPosts || serpResult.totalPosts,
  totalPostsLabel: profile.totalPostsLabel || serpResult.totalPostsLabel,
  metricsNote: profile.totalFollowers
    ? `Brand search — followers from @${profile.profileUsername} (discovered from Instagram mentions)`
    : serpResult.metricsNote,
  avgEngagement: profile.avgEngagement !== 'N/A' ? profile.avgEngagement : serpResult.avgEngagement,
});

const buildSearchMetrics = ({ analyzedCount, reportedTotal, label, followers, note, estimatedTotal }) => {
  const analyzed = Math.max(0, Number(analyzedCount) || 0);
  const reported = parseSerpTotalResults(reportedTotal);
  const useAnalyzed =
    !reported ||
    analyzed === 0 ||
    (reported > analyzed * 50 && analyzed <= 25);
  return {
    totalPosts: formatCount(useAnalyzed ? analyzed : reported),
    totalPostsLabel: useAnalyzed ? (label || 'Results analyzed') : 'Total matches',
    postsAnalyzed: analyzed,
    estimatedTotal: estimatedTotal || (useAnalyzed && reported > analyzed ? formatCount(reported) : null),
    totalFollowers: followers != null && followers !== '' ? formatCount(followers) : null,
    metricsNote: note || null,
  };
};

const decodeBearer = (raw) => {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw.trim());
  } catch {
    return raw.trim();
  }
};

const apiError = (label, err) => {
  const status = err.response?.status;
  const msg = err.response?.data?.error?.message
    || err.response?.data?.message
    || err.response?.data?.title
    || err.message;
  return new Error(`${label}: ${status ? `[${status}] ` : ''}${msg}`);
};

/** @returns {{ configured: boolean, label: string, detail?: string }[]} */
const getProviderStatus = () => [
  { key: 'SERPAPI_KEY', label: 'SerpAPI', configured: !!process.env.SERPAPI_KEY },
  { key: 'NEWS_API_KEY', label: 'NewsAPI', configured: !!process.env.NEWS_API_KEY },
  { key: 'TWITTER_BEARER_TOKEN', label: 'X (Twitter)', configured: !!process.env.TWITTER_BEARER_TOKEN },
  { key: 'INSTAGRAM_ACCESS_TOKEN', label: 'Instagram', configured: !!process.env.INSTAGRAM_ACCESS_TOKEN },
  {
    key: 'REDDIT',
    label: 'Reddit',
    configured: !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET),
    detail: !process.env.REDDIT_CLIENT_ID ? 'REDDIT_CLIENT_ID missing' : undefined,
  },
  { key: 'GROQ_API_KEY', label: 'AI Content (Groq)', configured: !!process.env.GROQ_API_KEY },
];

const serpSearch = async (params) => {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw apiError('SerpAPI', new Error('SERPAPI_KEY not configured in server environment'));
  const r = await axios.get('https://serpapi.com/search.json', {
    params: { api_key: key, ...params },
    timeout: 20000,
  });
  if (r.data?.error) throw new Error(r.data.error);
  return r.data;
};

const searchNewsApi = async (keyword, { headlines = false } = {}) => {
  const key = process.env.NEWS_API_KEY;
  if (!key) throw apiError('NewsAPI', new Error('NEWS_API_KEY not configured'));
  const url = headlines
    ? 'https://newsapi.org/v2/top-headlines'
    : 'https://newsapi.org/v2/everything';
  const params = headlines
    ? { country: 'in', apiKey: key, pageSize: 15, q: keyword || undefined }
    : { q: keyword, apiKey: key, pageSize: 10, sortBy: 'relevancy', language: 'en' };
  const r = await axios.get(url, { params, timeout: 15000 });
  if (r.data?.status === 'error') throw new Error(r.data.message || 'NewsAPI error');
  return r.data;
};

const searchTwitter = async (keyword) => {
  const token = decodeBearer(process.env.TWITTER_BEARER_TOKEN);
  if (!token) throw apiError('Twitter', new Error('TWITTER_BEARER_TOKEN not configured'));

  const query = keyword.startsWith('#') ? keyword : `${keyword} -is:retweet lang:en`;
  const r = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
    params: {
      query,
      max_results: 10,
      'tweet.fields': 'public_metrics,created_at,author_id',
      expansions: 'author_id',
      'user.fields': 'username,name,public_metrics',
    },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });

  const tweets = r.data?.data || [];
  const users = Object.fromEntries(
    (r.data?.includes?.users || []).map((u) => [u.id, u])
  );
  const meta = r.data?.meta || {};

  const topPosts = tweets.map((t) => {
    const u = users[t.author_id];
    const m = t.public_metrics || {};
    return {
      title: t.text?.slice(0, 280) || 'Tweet',
      source: u ? `@${u.username}` : 'X',
      url: u ? `https://x.com/${u.username}/status/${t.id}` : `https://x.com/i/web/status/${t.id}`,
      description: '',
      publishedAt: t.created_at ? new Date(t.created_at).toLocaleDateString() : '',
      likes: formatCount(m.like_count),
      comments: formatCount(m.reply_count),
      views: formatCount(m.impression_count),
      shares: formatCount(m.retweet_count),
    };
  });

  const metrics = buildSearchMetrics({
    analyzedCount: topPosts.length,
    reportedTotal: meta.result_count,
    label: 'Tweets analyzed',
    note: meta.result_count
      ? `X API estimate: ~${formatCount(meta.result_count)} matching tweets (sample of ${topPosts.length} shown)`
      : null,
  });
  return {
    source: 'twitter',
    avgEngagement: topPosts.length ? calcAvgEngagement(topPosts) : 'N/A',
    topPosts,
    ...metrics,
  };
};

const calcAvgEngagement = (posts) => {
  const postsWithData = posts.filter((p) =>
    parseMetricNumber(p.likes) > 0 ||
    parseMetricNumber(p.comments) > 0 ||
    parseMetricNumber(p.views) > 0 ||
    parseMetricNumber(p.shares) > 0
  );
  if (!postsWithData.length) return 'N/A';
  const totals = postsWithData.map((p) =>
    parseMetricNumber(p.likes) +
    parseMetricNumber(p.comments) +
    parseMetricNumber(p.shares) +
    parseMetricNumber(p.views) * 0.01
  );
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  return avg > 0 ? formatCount(Math.round(avg)) : 'N/A';
};

let redditTokenCache = { token: null, expires: 0 };

const getRedditToken = async () => {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw apiError('Reddit', new Error('REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET required'));
  }
  if (redditTokenCache.token && Date.now() < redditTokenCache.expires) {
    return redditTokenCache.token;
  }
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const r = await axios.post(
    'https://www.reddit.com/api/v1/access_token',
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'YovoAI/1.0 (social-sensing)',
      },
      timeout: 10000,
    }
  );
  redditTokenCache = {
    token: r.data.access_token,
    expires: Date.now() + (r.data.expires_in || 3600) * 1000 - 60000,
  };
  return redditTokenCache.token;
};

const searchReddit = async (keyword) => {
  const token = await getRedditToken();
  const r = await axios.get('https://oauth.reddit.com/search', {
    params: { q: keyword, sort: 'relevance', limit: 10, type: 'link' },
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'YovoAI/1.0 (social-sensing)',
    },
    timeout: 15000,
  });

  const children = r.data?.data?.children || [];
  const topPosts = children.map(({ data: d }) => ({
    title: d.title || 'Reddit post',
    source: `r/${d.subreddit}`,
    url: d.url?.startsWith('http') ? d.url : `https://reddit.com${d.permalink}`,
    description: (d.selftext || '').slice(0, 200),
    publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toLocaleDateString() : '',
    likes: formatCount(d.ups),
    comments: formatCount(d.num_comments),
    views: 'N/A',
    shares: 'N/A',
  }));

  const dist = r.data?.data?.dist || children.length;
  const metrics = buildSearchMetrics({
    analyzedCount: topPosts.length,
    reportedTotal: dist,
    label: 'Posts analyzed',
    note: `Reddit search sample (${topPosts.length} posts)`,
  });
  return {
    source: 'reddit',
    avgEngagement: topPosts.length ? calcAvgEngagement(topPosts) : 'N/A',
    topPosts,
    ...metrics,
  };
};

const mapInstagramSerpPosts = (rawPosts, username) =>
  (rawPosts || []).slice(0, 10).map((m) => ({
    title: (m.caption || m.title || m.description || 'Instagram post').slice(0, 200),
    source: m.username ? `@${m.username}` : `@${username}`,
    url: m.link || m.permalink || '',
    description: m.media_type || m.type || '',
    publishedAt: m.date || (m.timestamp ? new Date(m.timestamp).toLocaleDateString() : ''),
    likes: formatCount(m.likes ?? m.like_count),
    comments: formatCount(m.comments ?? m.comments_count),
    views: m.views ? formatCount(parseMetricNumber(m.views)) : 'N/A',
    shares: 'N/A',
    thumbnail: m.thumbnail || m.display_url || '',
  }));

const parseInstagramFollowers = (data) => {
  const raw =
    data?.followers ??
    data?.follower_count ??
    data?.followers_count ??
    data?.user?.edge_followed_by?.count ??
    data?.user?.followers ??
    data?.profile?.followers ??
    data?.profile?.follower_count ??
    data?.ig_profile?.followers;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw;
  const parsed = parseMetricNumber(String(raw).replace(/followers?/gi, '').trim());
  return parsed > 0 ? parsed : null;
};

/** Parse "12.5K followers" / "1,234 Followers" from Google snippets */
const extractFollowersFromSnippet = (text) => {
  if (!text) return null;
  const s = String(text);
  const patterns = [
    /([\d][\d.,]*\s*[KMB]?)\s+followers/i,
    /followers?\s*[·:|\-]?\s*([\d][\d.,]*\s*[KMB]?)/i,
    /([\d][\d.,]*[KMB]?)\s+Followers/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const n = parseMetricNumber(m[1].replace(/\s+/g, ''));
      if (n > 0) return n;
    }
  }
  return null;
};

const collectTextBlobsFromGoogle = (data) => {
  const blobs = [];
  if (data.knowledge_graph) {
    blobs.push(JSON.stringify(data.knowledge_graph));
  }
  if (data.answer_box) {
    blobs.push(data.answer_box.snippet, data.answer_box.answer, data.answer_box.title);
  }
  for (const r of data.organic_results || []) {
    blobs.push(r.title, r.snippet, r.source, r.description);
  }
  return blobs.filter(Boolean);
};

const mapGoogleResultsToIgPosts = (organic, keyword) =>
  (organic || []).slice(0, 10).map((r) => {
    const handle = extractInstagramHandleFromUrl(r.link);
    return {
      title: r.title || 'Instagram mention',
      source: handle ? `@${handle}` : (r.source || 'Instagram'),
      url: r.link || '',
      description: r.snippet || '',
      publishedAt: r.date || '',
      likes: 'N/A',
      comments: 'N/A',
      views: 'N/A',
      shares: 'N/A',
      thumbnail: r.thumbnail || '',
    };
  });

/**
 * SerpAPI has no instagram_profile engine (returns 400).
 * Use Google search on instagram.com/{user} and parse follower counts from snippets.
 */
const fetchInstagramProfileMeta = async (username) => {
  const user = String(username).replace(/^@/, '').trim().toLowerCase();
  if (!isValidInstagramHandle(user)) {
    throw new Error(`Invalid Instagram username @${user}`);
  }

  const data = await serpSearch({
    engine: 'google',
    q: `site:instagram.com/${user}`,
    gl: 'in',
    hl: 'en',
    num: 8,
  });

  let followers = parseInstagramFollowers(data.knowledge_graph);
  const blobs = collectTextBlobsFromGoogle(data);
  if (!followers) {
    for (const blob of blobs) {
      followers = extractFollowersFromSnippet(blob);
      if (followers) break;
    }
  }

  const profileOrganic = (data.organic_results || []).filter(
    (r) => extractInstagramHandleFromUrl(r.link) === user
  );
  let topPosts = mapGoogleResultsToIgPosts(profileOrganic, user);

  if (!followers && topPosts.length) {
    for (const p of topPosts) {
      followers = extractFollowersFromSnippet(`${p.title} ${p.description}`);
      if (followers) break;
    }
  }

  if (!followers) {
    try {
      const extra = await serpSearch({
        engine: 'google',
        q: `"@${user}" instagram followers`,
        gl: 'in',
        hl: 'en',
        num: 5,
      });
      for (const blob of collectTextBlobsFromGoogle(extra)) {
        followers = extractFollowersFromSnippet(blob);
        if (followers) break;
      }
    } catch (_) {}
  }

  return { user, followers, postsCount: null, topPosts, raw: data };
};

const searchInstagramProfile = async (username) => {
  const { user, followers, postsCount, topPosts } = await fetchInstagramProfileMeta(username);
  if (!topPosts.length && !followers) {
    throw new Error(`No public Instagram profile data for @${user}`);
  }
  const metrics = buildSearchMetrics({
    analyzedCount: topPosts.length || 1,
    reportedTotal: postsCount,
    label: topPosts.length ? 'Posts analyzed' : 'Profile found',
    followers,
    note: followers != null
      ? `Public profile @${user} — ${formatCount(followers)} followers`
      : `Public profile @${user}`,
  });
  return {
    source: 'serpapi-google-profile',
    profileUsername: user,
    avgEngagement: topPosts.length ? calcAvgEngagement(topPosts) : 'N/A',
    topPosts: topPosts.length ? topPosts : [],
    ...metrics,
  };
};

/** Pick official brand account — highest followers among ranked handles (not first match) */
const pickBestInstagramProfile = async (handles, keyword, mentionCounts) => {
  const ranked = rankBrandHandles(handles, keyword, mentionCounts).slice(0, 6);
  const profiles = [];

  for (const handle of ranked) {
    try {
      const meta = await fetchInstagramProfileMeta(handle);
      profiles.push({
        ...meta,
        mentionScore: mentionCounts[meta.user] || 0,
        rankScore: scoreInstagramHandle(meta.user, keyword, mentionCounts[meta.user] || 0),
      });
    } catch (err) {
      console.warn(`[IG @${handle}]`, err.message);
    }
  }

  if (!profiles.length) return null;

  profiles.sort((a, b) => {
    const fa = a.followers || 0;
    const fb = b.followers || 0;
    if (fb !== fa) return fb - fa;
    if (b.mentionScore !== a.mentionScore) return b.mentionScore - a.mentionScore;
    return b.rankScore - a.rankScore;
  });

  const best = profiles[0];
  const base = brandKeywordBase(keyword);
  if (
    profiles.length > 1 &&
    isExactBrandKeyword(keyword, best.user) &&
    (best.followers || 0) < 500
  ) {
    const alt = profiles.find(
      (p) => p.user !== best.user && p.user.startsWith(base) && (p.followers || 0) > (best.followers || 0)
    );
    if (alt) return alt;
  }

  return best;
};

/** Brand name search: web posts + best-matching @handle (e.g. Aitota → @aitotateam) */
const searchInstagramBrand = async (keyword) => {
  const data = await serpSearch({
    engine: 'google',
    q: `${keyword} site:instagram.com`,
    gl: 'in',
    hl: 'en',
    num: 10,
  });
  const organic = data.organic_results || [];
  const mentionCounts = countHandleMentions(organic);
  let topPosts = mapGoogleResultsToIgPosts(organic, keyword);

  const discovered = await discoverInstagramHandles(keyword);
  const handles = [...discovered, ...brandHandleCandidates(keyword)];
  const bestProfile = await pickBestInstagramProfile(handles, keyword, mentionCounts);

  const profileUsername = bestProfile?.user || null;
  const followers = bestProfile?.followers || null;

  if (profileUsername) {
    const brandPosts = topPosts.filter(
      (p) =>
        p.url?.includes(`instagram.com/${profileUsername}`) ||
        p.source?.toLowerCase() === `@${profileUsername}`
    );
    const otherPosts = topPosts.filter((p) => !brandPosts.includes(p));
    topPosts = [...brandPosts, ...otherPosts].slice(0, 10);
  }

  if (!topPosts.length) {
    throw new Error(`No Instagram results found for "${keyword}"`);
  }

  const webTotal = parseSerpTotalResults(data.search_information?.total_results);
  const metrics = buildSearchMetrics({
    analyzedCount: topPosts.length,
    reportedTotal: webTotal,
    label: 'Posts analyzed',
    followers,
    note: followers
      ? `Brand "${keyword}" → official @${profileUsername} (${formatCount(followers)} followers, ${topPosts.length} mentions)`
      : `Instagram mentions for "${keyword}" — use @aitotateam for exact profile`,
  });

  return {
    source: followers ? 'serpapi-google-profile' : 'serpapi',
    profileUsername,
    avgEngagement: calcAvgEngagement(topPosts),
    topPosts,
    ...metrics,
  };
};

const getInstagramBusinessId = async (token) => {
  const r = await axios.get('https://graph.facebook.com/v21.0/me/accounts', {
    params: {
      access_token: token,
      fields: 'instagram_business_account{id,username}',
    },
    timeout: 15000,
  });
  const page = (r.data?.data || []).find((p) => p.instagram_business_account?.id);
  if (!page?.instagram_business_account?.id) {
    throw new Error('No Instagram Business account linked to this token');
  }
  return page.instagram_business_account;
};

const searchInstagram = async (keyword) => {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) throw apiError('Instagram', new Error('INSTAGRAM_ACCESS_TOKEN not configured'));

  const tag = keyword.replace(/^#/, '').trim();
  const ig = await getInstagramBusinessId(token);

  const hashtagRes = await axios.get('https://graph.facebook.com/v21.0/ig_hashtag_search', {
    params: { user_id: ig.id, q: tag, access_token: token },
    timeout: 15000,
  });

  const hashtagId = hashtagRes.data?.data?.[0]?.id;
  if (!hashtagId) {
    return {
      source: 'instagram',
      totalPosts: '0',
      totalPostsLabel: 'Hashtag posts',
      avgEngagement: 'N/A',
      topPosts: [],
      warnings: [`No Instagram hashtag found for "${tag}"`],
    };
  }

  const mediaRes = await axios.get(`https://graph.facebook.com/v21.0/${hashtagId}/recent_media`, {
    params: {
      user_id: ig.id,
      fields: 'id,caption,like_count,comments_count,timestamp,permalink,media_type',
      access_token: token,
    },
    timeout: 15000,
  });

  const media = mediaRes.data?.data || [];
  const topPosts = media.slice(0, 10).map((m) => ({
    title: (m.caption || 'Instagram post').slice(0, 200),
    source: `@${ig.username || 'instagram'}`,
    url: m.permalink || '',
    description: m.media_type || '',
    publishedAt: m.timestamp ? new Date(m.timestamp).toLocaleDateString() : '',
    likes: formatCount(m.like_count),
    comments: formatCount(m.comments_count),
    views: 'N/A',
    shares: 'N/A',
  }));

  const metrics = buildSearchMetrics({
    analyzedCount: topPosts.length,
    reportedTotal: media.length,
    label: 'Hashtag posts analyzed',
    note: `Instagram hashtag #${tag} (API returns recent media sample)`,
  });
  return {
    source: 'instagram',
    avgEngagement: topPosts.length ? calcAvgEngagement(topPosts) : 'N/A',
    topPosts,
    ...metrics,
  };
};

const extensionLooksLikeMetric = (ext) => {
  if (!ext || typeof ext !== 'string') return false;
  return /[\d.,]+\s*[KMB]?|\d+\s*(likes?|views?|comments?)/i.test(ext);
};

const mapSerpOrganic = (items) =>
  (items || []).slice(0, 10).map((r) => ({
    title: r.title || 'Untitled',
    source: r.source || r.displayed_link || r.channel?.name || '',
    url: r.link || '',
    description: r.snippet || r.description || '',
    publishedAt: r.date || '',
    likes: extensionLooksLikeMetric(r.extensions?.[0]) ? formatCount(parseMetricNumber(r.extensions[0])) : 'N/A',
    comments: 'N/A',
    views: r.views ? formatCount(parseMetricNumber(r.views)) : 'N/A',
    shares: 'N/A',
  }));

const searchSerpPlatform = async (keyword, platform) => {
  const siteMap = {
    twitter: 'site:x.com OR site:twitter.com',
    facebook: 'site:facebook.com',
    instagram: 'site:instagram.com/p OR site:instagram.com/reel',
    youtube: null,
    reddit: 'site:reddit.com',
    quora: 'site:quora.com',
    blog: 'site:medium.com OR site:blogspot.com',
    forum: 'site:stackoverflow.com OR site:discourse.org',
    articles: 'site:linkedin.com/pulse OR site:substack.com',
    news: null,
    reviews: 'site:trustpilot.com OR site:g2.com',
    post: null,
    comment: null,
    trend: null,
  };

  if (platform === 'youtube') {
    const ytKey = process.env.YOUTUBE_API_KEY;
    if (ytKey) {
      try {
        // Step 1: Search videos
        const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
          params: { part: 'snippet', q: keyword, type: 'video', maxResults: 10, key: ytKey, order: 'relevance' },
          timeout: 10000,
        });
        const items = searchRes.data?.items || [];
        if (items.length) {
          // Step 2: Get video stats (views, likes, comments)
          const videoIds = items.map((v) => v.id?.videoId).filter(Boolean).join(',');
          let statsMap = {};
          if (videoIds) {
            try {
              const statsRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: { part: 'statistics', id: videoIds, key: ytKey },
                timeout: 10000,
              });
              (statsRes.data?.items || []).forEach((v) => { statsMap[v.id] = v.statistics; });
            } catch (_) {}
          }
          const topPosts = items.map((v) => {
            const vid = v.id?.videoId;
            const stats = statsMap[vid] || {};
            return {
              title: v.snippet?.title || 'Video',
              source: v.snippet?.channelTitle || 'YouTube',
              url: vid ? `https://www.youtube.com/watch?v=${vid}` : '',
              description: v.snippet?.description?.slice(0, 200) || '',
              publishedAt: v.snippet?.publishedAt ? new Date(v.snippet.publishedAt).toLocaleDateString() : '',
              likes: formatCount(stats.likeCount),
              comments: formatCount(stats.commentCount),
              views: formatCount(stats.viewCount),
              shares: 'N/A',
              thumbnail: v.snippet?.thumbnails?.medium?.url || '',
            };
          });
          const totalResults = searchRes.data?.pageInfo?.totalResults || items.length;
          const metrics = buildSearchMetrics({
            analyzedCount: topPosts.length,
            reportedTotal: totalResults,
            label: 'Videos analyzed',
            note: `YouTube reports ~${formatCount(totalResults)} matching videos`,
          });
          return {
            source: 'youtube-api',
            avgEngagement: calcAvgEngagement(topPosts),
            topPosts,
            ...metrics,
          };
        }
      } catch (ytErr) {
        console.error('[YouTube API error]', ytErr.message);
      }
    }
    // Fallback to SerpAPI YouTube
    const data = await serpSearch({ engine: 'youtube', search_query: keyword });
    const videos = data.video_results || [];
    const topPosts = videos.slice(0, 10).map((v) => ({
      title: v.title || 'Video',
      source: v.channel?.name || 'YouTube',
      url: v.link || '',
      description: v.description || '',
      publishedAt: v.published_date || '',
      likes: 'N/A', comments: 'N/A',
      views: v.views ? formatCount(parseMetricNumber(v.views)) : 'N/A',
      shares: 'N/A',
    }));
    const metrics = buildSearchMetrics({
      analyzedCount: topPosts.length,
      reportedTotal: videos.length,
      label: 'Videos analyzed',
      note: 'SerpAPI YouTube sample (top results)',
    });
    return { source: 'serpapi-youtube', avgEngagement: calcAvgEngagement(topPosts), topPosts, ...metrics };
  }

  if (platform === 'news') {
    const data = await serpSearch({ engine: 'google_news', q: `"${keyword}"`, gl: 'in', hl: 'en' });
    const items = data.news_results || data.top_stories || [];
    // Filter strictly relevant results
    const filtered = items.filter((n) =>
      n.title?.toLowerCase().includes(keyword.toLowerCase().split(' ')[0]) ||
      n.snippet?.toLowerCase().includes(keyword.toLowerCase().split(' ')[0])
    );
    const finalItems = filtered.length ? filtered : items;
    const topPosts = finalItems.slice(0, 10).map((n) => ({
      title: n.title || 'News',
      source: n.source?.name || n.source || '',
      url: n.link || '',
      description: n.snippet || '',
      publishedAt: n.date || '',
      likes: 'N/A', comments: 'N/A', views: 'N/A', shares: 'N/A',
    }));
    const metrics = buildSearchMetrics({
      analyzedCount: topPosts.length,
      reportedTotal: finalItems.length,
      label: 'Articles analyzed',
      note: 'News articles matching keyword (sample)',
    });
    return {
      source: 'serpapi-news',
      avgEngagement: 'N/A',
      topPosts,
      ...metrics,
    };
  }

  if (platform === 'instagram' && isInstagramUsername(keyword)) {
    try {
      return await searchInstagramProfile(keyword);
    } catch (profileErr) {
      console.warn('[Instagram profile]', profileErr.message);
    }
  }

  const site = siteMap[platform];
  const q = site ? `${keyword} ${site}` : keyword;
  const data = await serpSearch({ engine: 'google', q, gl: 'in', hl: 'en', num: 10 });
  const organic = [...(data.organic_results || []), ...(data.perspectives || [])];
  const topPosts = mapSerpOrganic(organic);
  const webTotal = parseSerpTotalResults(data.search_information?.total_results);
  const metrics = buildSearchMetrics({
    analyzedCount: topPosts.length,
    reportedTotal: webTotal,
    label: 'Results analyzed',
    note: platform === 'instagram'
      ? 'Web mentions on Instagram — not total profile posts. Use @username for follower count.'
      : 'Google web search sample — not platform-native post totals',
  });
  return {
    source: 'serpapi',
    avgEngagement: topPosts.length ? calcAvgEngagement(topPosts) : 'N/A',
    topPosts,
    ...metrics,
  };
};

const searchKeyword = async (keyword, platform = 'news') => {
  const warnings = [];
  const errors = [];

  const tryProvider = async (name, fn) => {
    try {
      const result = await fn();
      if (result?.topPosts?.length || result?.totalFollowers) return result;
      if (result?.warnings?.length) warnings.push(...result.warnings);
      errors.push(`${name}: no results`);
      return null;
    } catch (e) {
      errors.push(e.message);
      return null;
    }
  };

  let result = null;

  if (platform === 'twitter' || platform === 'x') {
    result = await tryProvider('Twitter', () => searchTwitter(keyword));
  } else if (platform === 'instagram') {
    const cleaned = keyword.replace(/^@/, '').trim();
    const isHashtag = keyword.trim().startsWith('#');
    const tryIgProfile = (handle) =>
      tryProvider(`Instagram @${handle}`, () => searchInstagramProfile(handle));

    if (isHashtag) {
      result = await tryProvider('Instagram Hashtag', () => searchInstagram(keyword));
    } else {
      const brandResult = await tryProvider('Instagram Brand', () => searchInstagramBrand(keyword));
      let graphResult = null;
      if (process.env.INSTAGRAM_ACCESS_TOKEN) {
        graphResult = await tryProvider('Instagram Graph', () => searchInstagram(keyword));
      }
      if (brandResult && graphResult) {
        result = {
          ...brandResult,
          source: 'instagram+google',
          topPosts:
            graphResult.topPosts?.length >= (brandResult.topPosts?.length || 0)
              ? graphResult.topPosts
              : brandResult.topPosts,
          avgEngagement:
            graphResult.avgEngagement !== 'N/A'
              ? graphResult.avgEngagement
              : brandResult.avgEngagement,
          totalFollowers: brandResult.totalFollowers,
          profileUsername: brandResult.profileUsername,
          metricsNote: brandResult.metricsNote,
        };
      } else {
        result = brandResult || graphResult;
      }
      if (!result && isInstagramUsername(cleaned)) {
        result = await tryIgProfile(cleaned);
      }
    }

    if (!result) {
      result = await tryProvider('SerpAPI', () => searchSerpPlatform(keyword, platform));
    }
  } else if (platform === 'reddit') {
    result = await tryProvider('Reddit', () => searchReddit(keyword));
    if (!result) result = await tryProvider('SerpAPI', () => searchSerpPlatform(keyword, platform));
  } else if (platform === 'news') {
    // Use SerpAPI Google News first — more accurate
    result = await tryProvider('SerpAPI News', () => searchSerpPlatform(keyword, 'news'));
    if (!result) result = await tryProvider('NewsAPI', async () => {
      const data = await searchNewsApi(keyword);
      const articles = data.articles || [];
      const topPosts = articles.slice(0, 10).map((a) => ({
          title: a.title || 'Article',
          source: a.source?.name || '',
          url: a.url || '',
          description: a.description || '',
          publishedAt: a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : '',
          likes: 'N/A', comments: 'N/A', views: 'N/A', shares: 'N/A',
        }));
      const metrics = buildSearchMetrics({
        analyzedCount: topPosts.length,
        reportedTotal: data.totalResults,
        label: 'Articles analyzed',
        note: 'NewsAPI article sample',
      });
      return { source: 'newsapi', avgEngagement: 'N/A', topPosts, ...metrics };
    });
  } else if (['youtube', 'facebook', 'quora', 'blog', 'forum', 'articles', 'reviews', 'post', 'comment', 'trend'].includes(platform)) {
    result = await tryProvider('SerpAPI', () => searchSerpPlatform(keyword, platform));
  } else {
    result = await tryProvider('SerpAPI', () => searchSerpPlatform(keyword, platform));
  }

  if (!result?.topPosts?.length) {
    const errDetail = errors.length ? errors.join(' | ') : 'No data returned from configured providers';
    throw new Error(`No real results for "${keyword}" on ${PLATFORM_LABELS[platform] || platform}. ${errDetail}`);
  }

  return {
    results: {
      totalPosts: result.totalPosts,
      totalPostsLabel: result.totalPostsLabel,
      totalFollowers: result.totalFollowers,
      postsAnalyzed: result.postsAnalyzed,
      estimatedTotal: result.estimatedTotal,
      metricsNote: result.metricsNote,
      profileUsername: result.profileUsername,
      avgEngagement: result.avgEngagement,
      topPosts: result.topPosts,
    },
    source: result.source,
    warnings,
  };
};

const fetchTrends = async (geo = 'IN') => {
  const errors = [];

  try {
    const data = await serpSearch({
      engine: 'google_trends_trending_now',
      geo,
    });
    const daily = data.daily_searches || data.trending_searches || [];
    const items = Array.isArray(daily) ? daily : [];
    if (items.length) {
      const platforms = ['instagram', 'twitter', 'youtube', 'facebook'];
      return {
        source: 'serpapi-trends',
        trends: items.slice(0, 20).map((item, i) => ({
          tag: item.query || item.title || item.name || 'Trending',
          traffic: item.formattedTraffic || item.traffic || 'Live',
          platform: platforms[i % platforms.length],
          url: item.link || '',
        })),
      };
    }
  } catch (e) {
    errors.push(`SerpAPI Trends: ${e.message}`);
  }

  try {
    const newsData = await searchNewsApi('', { headlines: true });
    const articles = newsData.articles || [];
    if (articles.length) {
      const platforms = ['instagram', 'twitter', 'youtube', 'facebook'];
      return {
        source: 'newsapi-headlines',
        trends: articles.slice(0, 15).map((a, i) => ({
          tag: a.title || 'Headline',
          traffic: 'Live',
          platform: platforms[i % platforms.length],
          source: a.source?.name || '',
          url: a.url || '',
        })),
      };
    }
  } catch (e) {
    errors.push(`NewsAPI: ${e.message}`);
  }

  try {
    const r = await axios.get(`https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`, {
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YovoAI/1.0)' },
    });
    const xml = r.data;
    const titles = [...xml.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/g)].map((m) => m[1]).slice(1, 21);
    const traffic = [...xml.matchAll(/<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>/g)].map((m) => m[1]);
    if (titles.length) {
      const platforms = ['instagram', 'twitter', 'youtube', 'facebook'];
      return {
        source: 'google-rss',
        trends: titles.map((title, i) => ({
          tag: title,
          traffic: traffic[i] || 'Trending',
          platform: platforms[i % platforms.length],
        })),
      };
    }
  } catch (e) {
    errors.push(`Google RSS: ${e.message}`);
  }

  throw new Error(`Unable to load live trends. ${errors.join(' | ')}`);
};

const buildSentimentContext = async (keyword) => {
  const chunks = [];
  const errors = [];
  const cleaned = String(keyword).replace(/^@/, '').trim();

  if (isInstagramUsername(cleaned)) {
    try {
      const profile = await searchInstagramProfile(cleaned);
      if (profile.totalFollowers && profile.totalFollowers !== 'N/A') {
        chunks.push(`Instagram profile @${cleaned} has ${profile.totalFollowers} followers.`);
      }
      chunks.push(...profile.topPosts.map((p) => `${p.title}. ${p.description || ''}`));
    } catch (e) {
      errors.push(`Instagram profile: ${e.message}`);
    }
  }

  try {
    const data = await serpSearch({ engine: 'google', q: keyword, gl: 'in', num: 8 });
    const organic = data.organic_results || [];
    const overview = data.ai_overview?.text_blocks?.map((b) => b.snippet).filter(Boolean).join(' ') || '';
    chunks.push(...organic.map((r) => `${r.title}. ${r.snippet || ''}`));
    if (overview) chunks.push(overview);
  } catch (e) {
    errors.push(e.message);
  }

  if (!chunks.length && process.env.NEWS_API_KEY) {
    try {
      const data = await searchNewsApi(keyword);
      chunks.push(...(data.articles || []).map((a) => `${a.title}. ${a.description || ''}`));
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (!chunks.length && process.env.TWITTER_BEARER_TOKEN) {
    try {
      const tw = await searchTwitter(keyword);
      chunks.push(...tw.topPosts.map((p) => p.title));
    } catch (e) {
      errors.push(e.message);
    }
  }

  return {
    contextText: chunks.join(' ').slice(0, 4000),
    errors,
  };
};

module.exports = {
  PLATFORM_LABELS,
  formatCount,
  getProviderStatus,
  searchKeyword,
  fetchTrends,
  buildSentimentContext,
  searchNewsApi,
  serpSearch,
};
