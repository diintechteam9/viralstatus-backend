/**
 * Run: node scripts/test-views.js <instagram_reel_url>
 * Tests all stat sources and shows which one returns views.
 */
require('dotenv').config();
const { getPostStats } = require('../utils/socialPostStats');
const { fetchInstagramStatsFromRapidAPI } = require('../utils/instagramRapidApi');
const { fetchInstagramStatsFromEmbed, fetchInstagramViaOEmbed } = require('../utils/instagramEmbedStats');
const { normalizeInstagramUrl } = require('../utils/instagramRapidApi');

const url = process.argv[2];
if (!url) { console.error('Usage: node scripts/test-views.js <url>'); process.exit(1); }

(async () => {
  const normalized = normalizeInstagramUrl(url);
  console.log('\n=== Testing URL:', normalized, '===\n');

  console.log('1. Stats RapidAPI (instagram-scraper-api2 / instagram230):');
  const stats = await fetchInstagramStatsFromRapidAPI(normalized).catch(e => ({ error: e.message }));
  console.log(stats);

  console.log('\n2. Facebook oEmbed (likes + comments):');
  const oembed = await fetchInstagramViaOEmbed(normalized).catch(e => ({ error: e.message }));
  console.log(oembed);

  console.log('\n3. Embed HTML scraping (views + likes + comments):');
  const embed = await fetchInstagramStatsFromEmbed(normalized).catch(e => ({ error: e.message }));
  console.log(embed);

  console.log('\n4. Full getPostStats() result:');
  const full = await getPostStats(normalized).catch(e => ({ error: e.message }));
  console.log(full);
})();
