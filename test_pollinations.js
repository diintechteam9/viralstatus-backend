const https = require('https');

function fetchImage(prompt, seed) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=400&height=300&nologo=true`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*', 'Connection': 'close' }
    }, (res) => {
      console.log(`  -> HTTP ${res.statusCode}`);
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 1000) return reject(new Error('too small: ' + buf.length));
        resolve(buf.length);
      });
      res.on('error', reject);
    });
    req.setTimeout(45000, () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

async function test() {
  for (let i = 0; i < 6; i++) {
    const seed = Math.floor(Math.random() * 999999) + 1;
    const t = Date.now();
    console.log(`Image ${i + 1}/6 seed=${seed}...`);
    try {
      const size = await fetchImage('happy influencer', seed);
      console.log(`  OK: ${size} bytes in ${Date.now() - t}ms`);
    } catch (e) {
      console.log(`  FAIL: ${e.message} in ${Date.now() - t}ms`);
    }
    if (i < 5) await new Promise(r => setTimeout(r, 2000));
  }
  console.log('DONE');
}

test();
