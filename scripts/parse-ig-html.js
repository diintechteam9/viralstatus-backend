const fs = require('fs');
const h = fs.readFileSync('ig-page.html', 'utf8');

const patterns = [
  /"comment_count":(\d+)/g,
  /"comments_count":(\d+)/g,
  /"edge_media_to_comment":\{"count":(\d+)/g,
  /"edge_media_to_parent_comment":\{"count":(\d+)/g,
  /comment_count\\":(\d+)/g,
];

for (const p of patterns) {
  const m = [...h.matchAll(p)];
  if (m.length) console.log(p.source, m.slice(0, 8).map((x) => x[1]));
}

// Deep search in application/json scripts
const scripts = [...h.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)];
console.log('json scripts', scripts.length);
for (let i = 0; i < Math.min(scripts.length, 5); i++) {
  const text = scripts[i][1];
  if (!/comment/i.test(text)) continue;
  const cm = text.match(/"comment_count":(\d+)/);
  const em = text.match(/edge_media_to_comment[^}]*"count":(\d+)/);
  console.log('script', i, 'comment_count', cm?.[1], 'edge', em?.[1]);
}
