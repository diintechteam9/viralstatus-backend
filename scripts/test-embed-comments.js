require('dotenv').config();
const axios = require('axios');
const { parseEmbedCommentCount, fetchInstagramCommentsFromEmbed } = require('../utils/instagramEmbedStats');

const url = 'https://www.instagram.com/reel/DX0oabCTkJm/';

async function main() {
  const res = await axios.get('https://www.instagram.com/reel/DX0oabCTkJm/embed/captioned/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 25000,
  });
  console.log('html len', res.data.length);
  console.log('parsed', parseEmbedCommentCount(res.data));
  const m = res.data.match(/View all[\s\S]{0,40}comments/i);
  console.log('snippet', m ? m[0] : 'no match');
  console.log('fetch fn', await fetchInstagramCommentsFromEmbed(url));
}

main().catch(console.error);
