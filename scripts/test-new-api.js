const axios = require('axios');
const key = '486a9dff8emsh347571f914901e2p16c671jsn05b836dd3251';
const host = 'instagram-scraper-stable-api.p.rapidapi.com';
const headers = { 'x-rapidapi-key': key, 'x-rapidapi-host': host };
const reelUrl = 'https://www.instagram.com/reel/DKlMkFqSxJl/';
const shortcode = 'DKlMkFqSxJl';

// Generate all paths to try
const segments = [
  'post', 'reel', 'media', 'video', 'content',
  'post_info', 'reel_info', 'media_info', 'video_info',
  'post_details', 'reel_details', 'media_details',
  'post_data', 'reel_data', 'media_data',
  'post_stats', 'reel_stats', 'media_stats',
  'get_post', 'get_reel', 'get_media',
  'fetch_post', 'fetch_reel', 'fetch_media',
  'post_by_shortcode', 'reel_by_shortcode', 'media_by_shortcode',
  'by_shortcode', 'shortcode', 'by_url', 'by_code',
  'engagement', 'stats', 'insights', 'analytics',
  'user_posts', 'user_reels', 'user_media', 'user_feed',
  'following', 'following_v2', 'followers', 'user_info', 'user',
  'search', 'hashtag', 'explore', 'feed',
  'comments', 'likes', 'tagged',
];

const prefixes = ['', '/v1', '/v2', '/v3', '/api', '/api/v1'];

(async () => {
  console.log(`Testing ${prefixes.length * segments.length} paths on ${host}...\n`);
  let found = 0;
  for (const prefix of prefixes) {
    for (const seg of segments) {
      const path = `${prefix}/${seg}`;
      // Try GET
      try {
        const r = await axios.get(`https://${host}${path}`, {
          params: { shortcode, url: reelUrl, code_or_id_or_url: shortcode, username: 'instagram' },
          headers, timeout: 6000
        });
        console.log(`✅ GET ${path} -> ${JSON.stringify(r.data).slice(0, 300)}`);
        found++;
      } catch (e) {
        const msg = String(e.response?.data?.message || e.response?.data?.error || e.message);
        if (!msg.includes('does not exist')) {
          console.log(`⚠️  GET ${path} -> ${msg.slice(0, 100)}`);
        }
      }
      // Try POST
      try {
        const r = await axios.post(`https://${host}${path}`,
          { shortcode, url: reelUrl, username: 'instagram' },
          { headers: { ...headers, 'Content-Type': 'application/json' }, timeout: 6000 }
        );
        console.log(`✅ POST ${path} -> ${JSON.stringify(r.data).slice(0, 300)}`);
        found++;
      } catch (e) {
        const msg = String(e.response?.data?.message || e.response?.data?.error || e.message);
        if (!msg.includes('does not exist')) {
          console.log(`⚠️  POST ${path} -> ${msg.slice(0, 100)}`);
        }
      }
    }
  }
  console.log(`\nFound ${found} working endpoints.`);
})();
