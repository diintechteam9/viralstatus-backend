require('dotenv').config();
const axios = require('axios');
const token = process.env.INSTAGRAM_ACCESS_TOKEN;

// Instagram shortcode -> media ID conversion
function shortcodeToMediaId(shortcode) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = BigInt(0);
  for (const char of shortcode) {
    id = id * BigInt(64) + BigInt(alphabet.indexOf(char));
  }
  return id.toString();
}

async function get(url, params = {}) {
  try {
    const r = await axios.get(url, { params: { ...params, access_token: token }, timeout: 15000 });
    return r.data;
  } catch (e) {
    return { error: e.response?.data?.error?.message || e.message };
  }
}

(async () => {
  const shortcode = 'DKlMkFqSxJl';
  const mediaId = shortcodeToMediaId(shortcode);
  console.log('Shortcode:', shortcode, '-> Media ID:', mediaId);

  // Try fetching the media directly with just basic fields
  console.log('\n1. Direct media fetch (basic fields):');
  const r1 = await get(`https://graph.facebook.com/v21.0/${mediaId}`, {
    fields: 'id,like_count,comments_count,permalink,media_type'
  });
  console.log(r1);

  // Try with instagram_basic permission fields
  console.log('\n2. With owner field:');
  const r2 = await get(`https://graph.facebook.com/v21.0/${mediaId}`, {
    fields: 'id,like_count,comments_count,owner'
  });
  console.log(r2);

  // Try the URL-based approach
  console.log('\n3. URL-based lookup:');
  const r3 = await get('https://graph.facebook.com/v21.0/', {
    id: 'https://www.instagram.com/reel/DKlMkFqSxJl/',
    fields: 'id,like_count,comments_count'
  });
  console.log(r3);

  // Try searching across all IG accounts for this shortcode
  console.log('\n4. Search all IG accounts for this reel:');
  const accounts = await get('https://graph.facebook.com/v21.0/me/accounts', {
    fields: 'id,name,instagram_business_account', limit: 20
  });
  for (const page of (accounts?.data || [])) {
    const igId = page.instagram_business_account?.id;
    if (!igId) continue;
    // Search media by permalink
    const media = await get(`https://graph.facebook.com/v21.0/${igId}/media`, {
      fields: 'id,permalink,like_count,comments_count',
      limit: 100
    });
    const match = (media?.data || []).find(m => m.permalink?.includes(shortcode));
    if (match) {
      console.log(`FOUND in ${page.name}:`, match);
    }
  }

  // Try the participant's reel shortcode with different IG accounts
  console.log('\n5. Try fetching media ID directly as IG media:');
  const r5 = await get(`https://graph.facebook.com/v21.0/${mediaId}`, {
    fields: 'id,like_count,comments_count,media_type,timestamp,permalink'
  });
  console.log(r5);

})();
