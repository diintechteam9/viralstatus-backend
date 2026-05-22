require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const url = process.argv[2] || 'https://www.instagram.com/reel/DX0oabCTkJm/';

async function main() {
  try {
    const oembed = await axios.get('https://api.instagram.com/oembed', {
      params: { url },
      timeout: 15000,
    });
    console.log('oembed keys:', Object.keys(oembed.data));
  } catch (e) {
    console.log('oembed err:', e.message);
  }

  const htmlRes = await axios.get(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 25000,
  });
  const h = htmlRes.data;
  fs.writeFileSync('ig-page.html', h.slice(0, 500000));

  const patterns = [
    /"comment_count":(\d+)/g,
    /"comments_count":(\d+)/g,
    /edge_media_to_comment[^}]*"count":(\d+)/g,
  ];
  for (const p of patterns) {
    const matches = [...h.matchAll(p)];
    if (matches.length) {
      console.log(p.source, '->', matches.slice(0, 5).map((m) => m[1]));
    }
  }
}

main().catch((e) => console.error(e));
