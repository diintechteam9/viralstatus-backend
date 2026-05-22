require('dotenv').config();
const axios = require('axios');

const shortcode = process.argv[2] || 'DX0oabCTkJm';
const docIds = [
  '8845758201912924',
  '17864471937962929',
  '6157094360529268',
  '23128320004215523',
  '17880151568031844',
];

async function tryDoc(docId) {
  const variables = JSON.stringify({ shortcode });
  const url = `https://www.instagram.com/graphql/query/?doc_id=${docId}&variables=${encodeURIComponent(variables)}`;
  const res = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      'X-IG-App-ID': '936619743392459',
      'X-Requested-With': 'XMLHttpRequest',
    },
    timeout: 20000,
    validateStatus: () => true,
  });
  const media = res.data?.data?.xdt_shortcode_media || res.data?.data?.shortcode_media;
  const comments =
    media?.edge_media_to_comment?.count ??
    media?.edge_media_to_parent_comment?.count ??
    res.data?.data?.xdt_shortcode_media?.edge_media_to_comment?.count;
  return { docId, status: res.status, comments, likes: media?.edge_media_preview_like?.count, views: media?.video_view_count };
}

async function main() {
  for (const docId of docIds) {
    try {
      const r = await tryDoc(docId);
      console.log(r);
    } catch (e) {
      console.log(docId, e.message);
    }
  }
}

main();
