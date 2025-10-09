const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const ffmpeg = require('fluent-ffmpeg');

// Configure ffmpeg binaries
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}
if (ffprobePath) {
  ffmpeg.setFfprobePath(ffprobePath);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function srtTimestampToMs(ts) {
  // Format: HH:MM:SS,mmm
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{1,3})$/.exec(ts.trim());
  if (!match) return 0;
  const [, hh, mm, ss, ms] = match;
  return (
    parseInt(hh, 10) * 3600000 +
    parseInt(mm, 10) * 60000 +
    parseInt(ss, 10) * 1000 +
    parseInt(ms.padEnd(3, '0'), 10)
  );
}

function parseSrt(srtText) {
  if (!srtText || typeof srtText !== 'string') return [];
  const blocks = srtText.replace(/\r/g, '').split(/\n\n+/);
  const entries = [];
  for (const block of blocks) {
    const lines = block.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    // Some SRTs have an index line first
    let timeLineIdx = 0;
    if (/^\d+$/.test(lines[0])) {
      timeLineIdx = 1;
    }
    const timeLine = lines[timeLineIdx];
    const timeMatch = /(\d{2}:\d{2}:\d{2},\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{1,3})/.exec(timeLine);
    if (!timeMatch) continue;
    const startMs = srtTimestampToMs(timeMatch[1]);
    const endMs = srtTimestampToMs(timeMatch[2]);
    const text = lines.slice(timeLineIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    entries.push({ startMs, endMs, text });
  }
  return entries;
}

function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(str) {
  return new Set(normalizeText(str).split(' ').filter(Boolean));
}

function jaccard(aSet, bSet) {
  if (aSet.size === 0 && bSet.size === 0) return 1;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  const union = aSet.size + bSet.size - inter;
  return union === 0 ? 0 : inter / union;
}

function seconds(ms) {
  return ms / 1000;
}

// Group consecutive SRT sentences into paragraphs within [minSeconds, maxSeconds]
function groupSrtIntoParagraphs(srtEntries, count, minSeconds = 20, maxSeconds = 40) {
  const paragraphs = [];
  if (!Array.isArray(srtEntries) || srtEntries.length === 0) return paragraphs;
  const minS = Math.max(5, Math.min(60, Number(minSeconds) || 20));
  const maxS = Math.max(minS, Math.min(120, Number(maxSeconds) || 40));

  let i = 0;
  while (i < srtEntries.length && paragraphs.length < count) {
    let start = i;
    let end = i;
    let dur = srtEntries[end].endMs - srtEntries[start].startMs;
    while (end + 1 < srtEntries.length && seconds(dur) < minS) {
      end++;
      dur = srtEntries[end].endMs - srtEntries[start].startMs;
    }
    // If we overshoot max, try to back off one
    while (seconds(dur) > maxS && end > start) {
      end--;
      dur = srtEntries[end].endMs - srtEntries[start].startMs;
    }
    const texts = [];
    for (let k = start; k <= end; k++) texts.push(srtEntries[k].text);
    paragraphs.push(texts);
    i = end + 1;
  }
  return paragraphs;
}

// Map a paragraph (string) to best matching window of SRT entries, return [startMs, endMs]
function matchParagraphToSrtWindow(paragraphText, srtEntries) {
  const targetSet = tokenSet(paragraphText);
  if (targetSet.size === 0 || !Array.isArray(srtEntries) || srtEntries.length === 0) {
    return null;
  }
  let best = { score: -1, start: 0, end: 0 };
  for (let start = 0; start < srtEntries.length; start++) {
    let windowText = '';
    let windowSet = new Set();
    for (let end = start; end < srtEntries.length && end - start < 50; end++) {
      windowText += ' ' + srtEntries[end].text;
      windowSet = tokenSet(windowText);
      const score = jaccard(targetSet, windowSet);
      if (score > best.score) {
        best = { score, start, end };
      }
    }
  }
  if (best.score < 0.2) return null; // threshold to avoid bad matches
  const startMs = srtEntries[best.start].startMs;
  const endMs = srtEntries[best.end].endMs;
  return { startMs, endMs };
}

// ================= AI-assisted paragraph grouping (OpenRouter) =================
async function aiGroupSrtIntoParagraphs(srtEntries, count, minSeconds = 20, maxSeconds = 40) {
  // Prepare compact input for AI: index, start, end, text
  const items = srtEntries.map((e, idx) => ({
    i: idx + 1,
    s: Math.max(0, Math.round(e.startMs / 1000)),
    e: Math.max(0, Math.round(e.endMs / 1000)),
    t: e.text
  }));

  const body = {
    model: 'nousresearch/deephermes-3-llama-3-8b-preview:free',
    messages: [
      {
        role: 'user',
        content: [
          'You are grouping sequential SRT sentences into paragraphs for short video segments.',
          'CONSTRAINTS:',
          `- Return EXACTLY ${count} paragraphs.`,
          `- Each paragraph must contain SEQUENTIAL sentence indices (no reordering, no gaps).`,
          `- Duration of each paragraph = lastSentence.end - firstSentence.start. It MUST be between ${Number(minSeconds)} and ${Number(maxSeconds)} seconds when possible. If not perfectly possible, pick the closest within bounds without violating sequentiality.`,
          '- IMPORTANT: Select only the most content-rich, meaningful parts. Avoid filler, greetings, ums/ahs, sponsorships, tangents, or repetitive fluff.',
          '- Keep the ORIGINAL WORDS from the input sentences (no paraphrasing). We will render overlays from the exact text.',
          '- Prefer paragraphs with high information density, clear value, or key takeaways, even if that means skipping less important regions.',
          '- Do NOT try to cover the whole video. Return only the TOP important paragraphs anywhere in the video.',
          '- Paragraphs CAN be from non-adjacent parts of the video; they DO NOT need to be globally sequential.',
          '- Each paragraph itself must be sequential (indices increasing by 1). Paragraphs MAY be out of order relative to each other and MAY skip unimportant regions.',
          '- Avoid overlapping paragraphs unless unavoidable; prioritise distinct important regions.',
          '- A single sentence (by index) MUST NOT appear in more than one paragraph. No repetition of sentences across paragraphs.',
          '- Do NOT change sentence text. Do NOT invent sentences.',
          '',
          'INPUT SENTENCES (array of {i,s,e,t} where i=index, s=startSec, e=endSec, t=text):',
          JSON.stringify(items),
          '',
          'OUTPUT STRICT JSON ONLY with this schema: {"paragraphs": [ {"indices": [i1, i2, ...] }, ... ] }',
          `- The array length MUST be ${count}.`,
          '- Each "indices" array must be non-empty and strictly increasing by 1 (sequential).',
        ].join('\n')
      }
    ],
    max_tokens: 1600,
    temperature: 0.3
  };

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY missing');
  }

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error(`OpenRouter request failed: ${resp.status}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw new Error('Invalid JSON from AI');
  }
  if (!parsed || !Array.isArray(parsed.paragraphs)) {
    throw new Error('AI response missing paragraphs');
  }

  // Convert to array of sentence arrays (strings)
  const out = [];
  const minS = Math.max(1, Number(minSeconds) || 20);
  const maxS = Math.max(minS, Number(maxSeconds) || 40);
  const used = new Set();

  function clampIndicesToDuration(indices) {
    if (!Array.isArray(indices) || indices.length === 0) return [];
    // Ensure sequential order
    const sorted = [...indices].sort((a, b) => a - b);
    let startIdx = sorted[0] - 1;
    let endIdx = sorted[sorted.length - 1] - 1;
    startIdx = Math.max(0, Math.min(startIdx, srtEntries.length - 1));
    endIdx = Math.max(0, Math.min(endIdx, srtEntries.length - 1));
    if (endIdx < startIdx) [startIdx, endIdx] = [endIdx, startIdx];
    const startMs = srtEntries[startIdx].startMs;
    let endMs = srtEntries[endIdx].endMs;
    let dur = (endMs - startMs) / 1000;
    // If too long, shrink from the end until within maxS
    while (dur > maxS && endIdx > startIdx) {
      endIdx -= 1;
      endMs = srtEntries[endIdx].endMs;
      dur = (endMs - startMs) / 1000;
    }
    // If too short, try extend forward while keeping sequentiality
    while (dur < minS && endIdx + 1 < srtEntries.length) {
      endIdx += 1;
      endMs = srtEntries[endIdx].endMs;
      dur = (endMs - startMs) / 1000;
      if (dur > maxS) {
        endIdx -= 1;
        endMs = srtEntries[endIdx].endMs;
        break;
      }
    }
    const final = [];
    for (let i = startIdx; i <= endIdx; i++) final.push(i + 1);
    return final;
  }

  for (const p of parsed.paragraphs) {
    const rawIdxs = Array.isArray(p?.indices) ? p.indices : [];
    // Filter out indices already used in earlier paragraphs to avoid repetition
    const uniqueIdxs = rawIdxs.filter(i => !used.has(i));
    const idxs = clampIndicesToDuration(uniqueIdxs);
    if (!idxs.length) continue;
    idxs.forEach(i => used.add(i));
    const texts = [];
    for (const i of idxs) {
      const entry = srtEntries[i - 1];
      if (entry) texts.push(entry.text);
    }
    if (texts.length) out.push(texts);
  }
  return out;
}

async function ffmpegTrim(inputPath, startMs, endMs, outputPath) {
  const startSec = Math.max(0, startMs / 1000);
  const durationSec = Math.max(0.1, (endMs - startMs) / 1000);
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .inputOptions(['-ss ' + startSec])
      .outputOptions(['-t ' + durationSec, '-movflags +faststart'])
      .videoCodec('libx264')
      .audioCodec('aac')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

async function ffmpegNormalizePortrait(inputPath, outputPath) {
  // Scale and crop to 1080x1920 portrait to ensure 9:16 reels format
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters([
        'scale=1080:1920:force_original_aspect_ratio=increase',
        'crop=1080:1920:(iw-1080)/2:(ih-1920)/2'
      ])
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
      .on('error', reject)
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

async function ffmpegAddLogo(inputPath, logoPath, outputPath) {
  // Add logo overlay to a selected corner of the video
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .input(logoPath)
      .complexFilter([
        '[1:v]scale=200:-1[logo]' // Scale logo to 200px width, maintain aspect ratio
      ])
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
      .on('error', reject)
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

// No concat variant when returning individual segments

// ================= Text overlay helpers (drawtext) =================
const FONT_DIR = path.join(__dirname, '../assets/fonts');
const FONT_MAP = {
  notosans: path.join(FONT_DIR, 'NotoSans-Regular.ttf'),
  khand: path.join(FONT_DIR, 'Khand-Bold.ttf'),
  poppins: path.join(FONT_DIR, 'Poppins-Bold.ttf'),
  amaticsc: path.join(FONT_DIR, 'AmaticSC-Regular.ttf'),
  bebasneue: path.join(FONT_DIR, 'BebasNeue-Regular.ttf'),
  comfortaa: path.join(FONT_DIR, 'Comfortaa-VariableFont_wght.ttf'),
  exo2italic: path.join(FONT_DIR, 'Exo2-Italic-VariableFont_wght.ttf'),
  orbitron: path.join(FONT_DIR, 'Orbitron-Regular.ttf'),
  pacifico: path.join(FONT_DIR, 'Pacifico-Regular.ttf'),
  shadowsintolight: path.join(FONT_DIR, 'ShadowsIntoLight-Regular.ttf'),
  // Newly added fonts
  lato: path.join(FONT_DIR, 'Lato-Regular.ttf'),
  'poppins-regular': path.join(FONT_DIR, 'Poppins-Regular.ttf'),
  anton: path.join(FONT_DIR, 'Anton-Regular.ttf'),
  proteststrike: path.join(FONT_DIR, 'ProtestStrike-Regular.ttf'),
  specialgothic: path.join(FONT_DIR, 'SpecialGothic-Regular.ttf'),
};

function resolveFontPath(fontKey) {
  const key = (fontKey || 'notosans').toLowerCase();
  const candidate = FONT_MAP[key] || FONT_MAP.notosans;
  return fs.existsSync(candidate) ? candidate : null;
}

function cleanTextForDrawtext(text) {
  if (!text) return '';
  return String(text)
    .replace(/\r\n/g, ' ')
    .replace(/[\r\n]/g, ' ')
    .replace(/["']/g, '')
    .replace(/:/g, ' ')
    .replace(/;/g, ',')
    .replace(/\\/g, '/')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/%/g, 'percent')
    .replace(/=/g, ' equals ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDrawtextFilter(text, fontKey = 'notosans', position = 'bottom', textColor = 'white') {
  const yExpr = position === 'top' ? '120' : 'h-(text_h+220)';
  const isWhiteText = textColor === 'white';
  const fontColor = isWhiteText ? '0xFDFDFD' : '0x000000';
  const borderColor = isWhiteText ? '0x000000' : '0xFFFFFF';
  const shadowColor = isWhiteText ? '0x000000AA' : '0xFFFFFFAA';
  const boxColor = isWhiteText ? 'black@0.35' : 'white@0.35';
  const base = [
    `text='${text}'`,
    `fontcolor=${fontColor}`,
    `fontsize=72`,
    `borderw=2`,
    `bordercolor=${borderColor}`,
    `shadowcolor=${shadowColor}`,
    `shadowx=2`,
    `shadowy=2`,
    `box=1`,
    `boxcolor=${boxColor}`,
    `boxborderw=16`,
    `x=(w-text_w)/2`,
    `y=${yExpr}`,
    `line_spacing=12`
  ].join(':');
  const fontPath = resolveFontPath(fontKey);
  if (fontPath) {
    const fontPathUnix = fontPath.replace(/\\/g, '/');
    return `drawtext=fontfile='${fontPathUnix}':${base}`;
  }
  return `drawtext=${base}`;
}

function matchWordSrtToSegments(segments, wordEntries) {
  const segmentOverlays = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const overlays = [];
    for (const w of wordEntries) {
      if (w.startMs >= seg.startMs && w.endMs <= seg.endMs) {
        overlays.push({
          startTime: (w.startMs - seg.startMs) / 1000,
          endTime: (w.endMs - seg.startMs) / 1000,
          text: w.text
        });
      }
    }
    segmentOverlays.push(overlays);
  }
  return segmentOverlays;
}

exports.generateImportantParagraphs = async (req, res) => {
  try {
    const { srt, count = 3, minSeconds = 20, maxSeconds = 40 } = req.body || {};
    const sentences = parseSrt(String(srt || ''));
    if (!sentences.length) {
      return res.status(400).json({ error: 'Invalid or empty SRT' });
    }
    const num = Math.max(1, Math.min(5, parseInt(count, 10) || 3));
    // Try AI grouping first
    try {
      const aiParagraphs = await aiGroupSrtIntoParagraphs(sentences, num, minSeconds, maxSeconds);
      if (Array.isArray(aiParagraphs) && aiParagraphs.length === num) {
        return res.json({ paragraphs: aiParagraphs });
      }
    } catch (e) {
      // Fall through to deterministic grouping
    }
    const fallback = groupSrtIntoParagraphs(sentences, num, minSeconds, maxSeconds);
    return res.json({ paragraphs: fallback });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to generate paragraphs' });
  }
};

exports.trimByParagraphs = async (req, res) => {
  // Expects multipart/form-data: video (file), srt (text), wordSrt? (text), fontKey?, textColor?, paragraphs (json string)
  const jobId = uuidv4();
  const jobDir = path.join(__dirname, '..', 'temp', 'vts', jobId);
  ensureDir(jobDir);
  try {
    console.log(`[VTS] Job ${jobId}: trimByParagraphs request received`);
    // Multer fields: video, outro (optional), logo (optional)
    const videoFile = (req.files && Array.isArray(req.files.video) && req.files.video[0]) || req.file;
    const outroFile = req.files && Array.isArray(req.files.outro) ? req.files.outro[0] : null;
    const logoFile = req.files && Array.isArray(req.files.logo) ? req.files.logo[0] : null;
    const srtText = String(req.body.srt || '');
    const wordSrtText = String(req.body.wordSrt || '');
    const fontKey = String(req.body.fontKey || 'notosans').toLowerCase();
    const textColor = String(req.body.textColor || 'white').toLowerCase();
    let paragraphsRaw = req.body.paragraphs;
    let paragraphs = [];
    if (typeof paragraphsRaw === 'string') {
      try { paragraphs = JSON.parse(paragraphsRaw); } catch { paragraphs = []; }
    } else if (Array.isArray(paragraphsRaw)) {
      paragraphs = paragraphsRaw;
    }
    if (!videoFile || !srtText || !paragraphs.length) {
      return res.status(400).json({ error: 'Missing video, srt or paragraphs' });
    }
    const srtEntries = parseSrt(srtText);
    if (!srtEntries.length) {
      return res.status(400).json({ error: 'Invalid SRT' });
    }
    const wordEntries = parseSrt(wordSrtText).map(e => ({ startMs: e.startMs, endMs: e.endMs, text: e.text }));

    // Normalize paragraphs to strings (frontend may send strings already)
    const paragraphStrings = paragraphs.map(p => Array.isArray(p) ? p.join(' ') : String(p));

    // Find time windows
    const windows = [];
    for (const pText of paragraphStrings) {
      const win = matchParagraphToSrtWindow(pText, srtEntries);
      if (win && win.endMs > win.startMs) {
        windows.push(win);
      }
    }
    if (!windows.length) {
      return res.status(400).json({ error: 'Failed to match any paragraph to SRT' });
    }

    // Produce trimmed segments (+ optional word-level overlays)
    const segmentsMeta = [];
    const overlaysPerSegment = matchWordSrtToSegments(windows, wordEntries);
    let index = 1;
    for (const w of windows) {
      const rawSegPath = path.join(jobDir, `seg_raw_${index}.mp4`);
      const portraitSegPath = path.join(jobDir, `seg_portrait_${index}.mp4`);
      const finalSegPath = path.join(jobDir, `seg_${index}.mp4`);
      // Guard very short clips
      const minEnd = Math.min(w.endMs, w.startMs + 1000);
      const startMs = w.startMs;
      const endMs = Math.max(minEnd, w.endMs);
      // eslint-disable-next-line no-await-in-loop
      console.log(`[VTS] Job ${jobId}: [Seg ${index}] Trimming start -> ${startMs}ms to ${endMs}ms`);
      await ffmpegTrim(videoFile.path, startMs, endMs, rawSegPath);
      console.log(`[VTS] Job ${jobId}: [Seg ${index}] Trimming done -> ${rawSegPath}`);

      // Normalize to 9:16 portrait first
      console.log(`[VTS] Job ${jobId}: [Seg ${index}] Portrait normalization start`);
      await ffmpegNormalizePortrait(rawSegPath, portraitSegPath);
      console.log(`[VTS] Job ${jobId}: [Seg ${index}] Portrait normalization done -> ${portraitSegPath}`);
      try { fs.unlinkSync(rawSegPath); } catch {}

      // Add logo overlay if provided
      let logoProcessedPath = portraitSegPath;
      if (logoFile && logoFile.path) {
        const logoOverlayPath = path.join(jobDir, `seg_logo_${index}.mp4`);
        console.log(`[VTS] Job ${jobId}: [Seg ${index}] Logo overlay start`);
        try {
          // Determine overlay expression by position
          const pos = (textColor && req.body.logoPosition ? String(req.body.logoPosition) : 'top-right').toLowerCase();
          let overlayExpr = 'W-w-20:20'; // top-right default
          if (pos === 'top-left') overlayExpr = '20:20';
          else if (pos === 'bottom-left') overlayExpr = '20:H-h-20';
          else if (pos === 'bottom-right') overlayExpr = 'W-w-20:H-h-20';

          await new Promise((resolve, reject) => {
            ffmpeg(portraitSegPath)
              .input(logoFile.path)
              .complexFilter([
                '[1:v]scale=200:-1[logo]',
                `[0:v][logo]overlay=${overlayExpr}`
              ])
              .videoCodec('libx264')
              .audioCodec('aac')
              .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
              .on('error', reject)
              .on('end', resolve)
              .save(logoOverlayPath);
          });
          console.log(`[VTS] Job ${jobId}: [Seg ${index}] Logo overlay done -> ${logoOverlayPath}`);
          logoProcessedPath = logoOverlayPath;
          try { fs.unlinkSync(portraitSegPath); } catch {}
        } catch (logoError) {
          console.warn(`[VTS] Job ${jobId}: [Seg ${index}] Logo overlay failed, continuing without logo:`, logoError.message);
        }
      }

      const overlays = overlaysPerSegment[index - 1] || [];
      if (overlays.length > 0) {
        const MAX_OVERLAYS = 25;
        let selected = overlays;
        if (overlays.length > MAX_OVERLAYS) {
          const step = Math.max(1, Math.ceil(overlays.length / MAX_OVERLAYS));
          selected = overlays.filter((_, i) => i % step === 0).slice(0, MAX_OVERLAYS);
        }
        const drawFilters = [];
        let lastLabel = '0:v';
        console.log(`[VTS] Job ${jobId}: [Seg ${index}] Text overlay start with ${selected.length} overlays`);
        for (let j = 0; j < selected.length; j++) {
          const o = selected[j];
          const clean = cleanTextForDrawtext(o.text);
          if (!clean) continue;
          const position = (j % 2 === 0) ? 'top' : 'bottom';
          const draw = buildDrawtextFilter(clean, fontKey, position, textColor);
          const outLabel = (j === selected.length - 1) ? 'vout' : `v_${j}`;
          const filter = `[${lastLabel}]${draw}:enable='between(t,${Math.max(0, o.startTime).toFixed(3)},${Math.max(0, o.endTime).toFixed(3)})'[${outLabel}]`;
          drawFilters.push(filter);
          lastLabel = outLabel;
        }
        if (drawFilters.length > 0) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve, reject) => {
            let cmd = ffmpeg().input(logoProcessedPath);
            cmd = cmd.complexFilter(drawFilters).outputOptions(['-map', '[vout]', '-map', '0:a?']);
            cmd
              .videoCodec('libx264')
              .audioCodec('aac')
              .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
              .on('error', reject)
              .on('end', resolve)
              .save(finalSegPath);
          });
          console.log(`[VTS] Job ${jobId}: [Seg ${index}] Text overlay done -> ${finalSegPath}`);
          // keep finalSegPath
        } else {
          try { fs.copyFileSync(logoProcessedPath, finalSegPath); } catch {}
        }
      } else {
        try { fs.copyFileSync(logoProcessedPath, finalSegPath); } catch {}
      }

      // If outro provided, normalize both segment and outro to identical params and append
      if (outroFile && outroFile.path) {
        const outroPortrait = path.join(jobDir, `outro_${index}.mp4`);
        try {
          // 1) Normalize outro to portrait
          console.log(`[VTS] Job ${jobId}: [Seg ${index}] Outro normalization start`);
          // eslint-disable-next-line no-await-in-loop
          await ffmpegNormalizePortrait(outroFile.path, outroPortrait);

          // 2) Normalize both the segment and outro to consistent codec/fps/pix_fmt/audio
          const segNorm = path.join(jobDir, `seg_norm_${index}.mp4`);
          const outroNorm = path.join(jobDir, `outro_norm_${index}.mp4`);

          // Normalize segment (finalSegPath currently points to portrait+overlay video)
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve, reject) => {
            ffmpeg(finalSegPath)
              .videoFilters([
                'scale=1080:1920:force_original_aspect_ratio=increase',
                'crop=1080:1920:(iw-1080)/2:(ih-1920)/2',
                'fps=30'
              ])
              .videoCodec('libx264')
              .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart', '-preset veryfast', '-crf 23'])
              .audioCodec('aac')
              .audioChannels(2)
              .audioFrequency(48000)
              .addOption('-shortest')
              .on('error', reject)
              .on('end', resolve)
              .save(segNorm);
          });

          // Normalize outro
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve, reject) => {
            ffmpeg(outroPortrait)
              .videoFilters([
                'scale=1080:1920:force_original_aspect_ratio=increase',
                'crop=1080:1920:(iw-1080)/2:(ih-1920)/2',
                'fps=30'
              ])
              .videoCodec('libx264')
              .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart', '-preset veryfast', '-crf 23'])
              .audioCodec('aac')
              .audioChannels(2)
              .audioFrequency(48000)
              .addOption('-shortest')
              .on('error', reject)
              .on('end', resolve)
              .save(outroNorm);
          });

          // 3) Concat normalized files using demuxer
          const concatList = path.join(jobDir, `concat_${index}.txt`);
          const listContent = [segNorm, outroNorm]
            .map(p => `file '${path.resolve(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
          fs.writeFileSync(concatList, listContent);
          const withOutro = path.join(jobDir, `seg_with_outro_${index}.mp4`);
          console.log(`[VTS] Job ${jobId}: [Seg ${index}] Outro concat start`);
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve, reject) => {
            ffmpeg()
              .input(concatList)
              .inputOptions(['-f concat', '-safe 0'])
              .videoCodec('libx264')
              .audioCodec('aac')
              .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart', '-preset veryfast', '-crf 23'])
              .on('error', reject)
              .on('end', resolve)
              .save(withOutro);
          });
          console.log(`[VTS] Job ${jobId}: [Seg ${index}] Outro concat done -> ${withOutro}`);

          // Replace finalSegPath with concatenated output
          try { fs.copyFileSync(withOutro, finalSegPath); } catch {}
        } catch (_) {
          // Fallback: keep finalSegPath without outro
        }
      }

      // Clean up temporary logo overlay file if it was created
      if (logoProcessedPath !== portraitSegPath) {
        try { fs.unlinkSync(logoProcessedPath); } catch {}
      }

      segmentsMeta.push({
        index,
        startMs,
        endMs,
        path: finalSegPath,
        url: `/api/vts/segment/${jobId}/${index}`
      });
      index++;
    }

    const responsePayload = {
      success: true,
      jobId,
      segments: segmentsMeta.map(({ index, startMs, endMs, url }) => ({ index, startMs, endMs, url }))
    };
    // Attempt to remove original temp uploads (multer) now that outputs are ready
    try {
      if (videoFile?.path && fs.existsSync(videoFile.path)) { try { fs.unlinkSync(videoFile.path); } catch(_) {} }
      if (outroFile?.path && fs.existsSync(outroFile.path)) { try { fs.unlinkSync(outroFile.path); } catch(_) {} }
      if (logoFile?.path && fs.existsSync(logoFile.path)) { try { fs.unlinkSync(logoFile.path); } catch(_) {} }
    } catch (_) {}
    return res.json(responsePayload);
  } catch (err) {
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
    } catch {}
    return res.status(500).json({ error: err.message || 'Failed to trim by paragraphs' });
  }
};

exports.streamSegment = async (req, res) => {
  try {
    const { jobId, index } = req.params;
    if (!jobId || !index) return res.status(400).json({ error: 'Missing params' });
    const segPath = path.join(__dirname, '..', 'temp', 'vts', jobId, `seg_${Number(index)}.mp4`);
    if (!fs.existsSync(segPath)) return res.status(404).json({ error: 'Segment not found' });
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="seg_${Number(index)}.mp4"`);
    fs.createReadStream(segPath).pipe(res);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to stream segment' });
  }
};

exports.cleanupJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!jobId) return res.status(400).json({ error: 'Missing jobId' });
    const jobDir = path.join(__dirname, '..', 'temp', 'vts', jobId);
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
    } catch {}
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to cleanup job' });
  }
};
// Internal helper used by async job service to generate segment files and return their paths
// params: { jobId, inputPath, srt, wordSrt, paragraphs, fontKey, textColor, logoFilePath, logoPosition, outroFilePath }
// onProgress: optional callback(number)
exports.trimByParagraphsInternal = async (params, onProgress) => {
  const {
    jobId,
    inputPath,
    srt,
    wordSrt,
    paragraphs,
    fontKey = 'notosans',
    textColor = 'white',
    logoFilePath = null,
    logoPosition = 'top-right',
    outroFilePath = null
  } = params || {};
  if (!jobId) throw new Error('jobId required');
  if (!inputPath || !fs.existsSync(inputPath)) throw new Error('Input video not found');
  if (!srt) throw new Error('SRT required');
  const jobDir = path.join(__dirname, '..', 'temp', 'vts', jobId);
  ensureDir(jobDir);
  const srtEntries = parseSrt(String(srt));
  if (!srtEntries.length) throw new Error('Invalid SRT');
  const wordEntries = parseSrt(String(wordSrt || '')).map(e => ({ startMs: e.startMs, endMs: e.endMs, text: e.text }));
  const paragraphStrings = (Array.isArray(paragraphs) ? paragraphs : []).map(p => Array.isArray(p) ? p.join(' ') : String(p));
  if (!paragraphStrings.length) throw new Error('Paragraphs required');
  const windows = [];
  for (const pText of paragraphStrings) {
    const win = matchParagraphToSrtWindow(pText, srtEntries);
    if (win && win.endMs > win.startMs) windows.push(win);
  }
  if (!windows.length) throw new Error('Failed to match any paragraph to SRT');
  const overlaysPerSegment = matchWordSrtToSegments(windows, wordEntries);
  const segmentPaths = [];
  let index = 1;
  for (const w of windows) {
    if (typeof onProgress === 'function') onProgress(10 + Math.floor(((index - 1) / windows.length) * 60));
    const rawSegPath = path.join(jobDir, `seg_raw_${index}.mp4`);
    const portraitSegPath = path.join(jobDir, `seg_portrait_${index}.mp4`);
    const finalSegPath = path.join(jobDir, `seg_${index}.mp4`);
    const minEnd = Math.min(w.endMs, w.startMs + 1000);
    const startMs = w.startMs;
    const endMs = Math.max(minEnd, w.endMs);
    // Trim
    // eslint-disable-next-line no-await-in-loop
    await ffmpegTrim(inputPath, startMs, endMs, rawSegPath);
    // Normalize portrait
    // eslint-disable-next-line no-await-in-loop
    await ffmpegNormalizePortrait(rawSegPath, portraitSegPath);
    try { fs.unlinkSync(rawSegPath); } catch {}
    // Optional logo
    let logoProcessedPath = portraitSegPath;
    if (logoFilePath) {
      const logoOverlayPath = path.join(jobDir, `seg_logo_${index}.mp4`);
      try {
        const pos = String(logoPosition || 'top-right').toLowerCase();
        let overlayExpr = 'W-w-20:20';
        if (pos === 'top-left') overlayExpr = '20:20';
        else if (pos === 'bottom-left') overlayExpr = '20:H-h-20';
        else if (pos === 'bottom-right') overlayExpr = 'W-w-20:H-h-20';
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve, reject) => {
          ffmpeg(portraitSegPath)
            .input(logoFilePath)
            .complexFilter([
              '[1:v]scale=200:-1[logo]',
              `[0:v][logo]overlay=${overlayExpr}`
            ])
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
            .on('error', reject)
            .on('end', resolve)
            .save(logoOverlayPath);
        });
        logoProcessedPath = logoOverlayPath;
        try { fs.unlinkSync(portraitSegPath); } catch {}
      } catch(_) {}
    }
    // Word overlays
    const overlays = overlaysPerSegment[index - 1] || [];
    if (overlays.length > 0) {
      const MAX_OVERLAYS = 25;
      let selected = overlays;
      if (overlays.length > MAX_OVERLAYS) {
        const step = Math.max(1, Math.ceil(overlays.length / MAX_OVERLAYS));
        selected = overlays.filter((_, i) => i % step === 0).slice(0, MAX_OVERLAYS);
      }
      const drawFilters = [];
      let lastLabel = '0:v';
      for (let j = 0; j < selected.length; j++) {
        const o = selected[j];
        const clean = cleanTextForDrawtext(o.text);
        if (!clean) continue;
        const position = (j % 2 === 0) ? 'top' : 'bottom';
        const draw = buildDrawtextFilter(clean, fontKey, position, textColor);
        const outLabel = (j === selected.length - 1) ? 'vout' : `v_${j}`;
        const filter = `[${lastLabel}]${draw}:enable='between(t,${Math.max(0, o.startTime).toFixed(3)},${Math.max(0, o.endTime).toFixed(3)})'[${outLabel}]`;
        drawFilters.push(filter);
        lastLabel = outLabel;
      }
      if (drawFilters.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve, reject) => {
          let cmd = ffmpeg().input(logoProcessedPath);
          cmd = cmd.complexFilter(drawFilters).outputOptions(['-map', '[vout]', '-map', '0:a?']);
          cmd
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
            .on('error', reject)
            .on('end', resolve)
            .save(finalSegPath);
        });
      } else {
        try { fs.copyFileSync(logoProcessedPath, finalSegPath); } catch {}
      }
    } else {
      try { fs.copyFileSync(logoProcessedPath, finalSegPath); } catch {}
    }
    // Optional outro concat
    if (outroFilePath) {
      const outroPortrait = path.join(jobDir, `outro_${index}.mp4`);
      try {
        // eslint-disable-next-line no-await-in-loop
        await ffmpegNormalizePortrait(outroFilePath, outroPortrait);
        const segNorm = path.join(jobDir, `seg_norm_${index}.mp4`);
        const outroNorm = path.join(jobDir, `outro_norm_${index}.mp4`);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve, reject) => {
          ffmpeg(finalSegPath)
            .videoFilters([
              'scale=1080:1920:force_original_aspect_ratio=increase',
              'crop=1080:1920:(iw-1080)/2:(ih-1920)/2',
              'fps=30'
            ])
            .videoCodec('libx264')
            .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart', '-preset veryfast', '-crf 23'])
            .audioCodec('aac')
            .audioChannels(2)
            .audioFrequency(48000)
            .addOption('-shortest')
            .on('error', reject)
            .on('end', resolve)
            .save(segNorm);
        });
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve, reject) => {
          ffmpeg(outroPortrait)
            .videoFilters([
              'scale=1080:1920:force_original_aspect_ratio=increase',
              'crop=1080:1920:(iw-1080)/2:(ih-1920)/2',
              'fps=30'
            ])
            .videoCodec('libx264')
            .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart', '-preset veryfast', '-crf 23'])
            .audioCodec('aac')
            .audioChannels(2)
            .audioFrequency(48000)
            .addOption('-shortest')
            .on('error', reject)
            .on('end', resolve)
            .save(outroNorm);
        });
        const concatList = path.join(jobDir, `concat_${index}.txt`);
        const listContent = [segNorm, outroNorm]
          .map(p => `file '${path.resolve(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(concatList, listContent);
        const withOutro = path.join(jobDir, `seg_with_outro_${index}.mp4`);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(concatList)
            .inputOptions(['-f concat', '-safe 0'])
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart', '-preset veryfast', '-crf 23'])
            .on('error', reject)
            .on('end', resolve)
            .save(withOutro);
        });
        try { fs.copyFileSync(withOutro, finalSegPath); } catch {}
      } catch(_) {}
    }
    if (logoProcessedPath !== portraitSegPath) { try { fs.unlinkSync(logoProcessedPath); } catch {} }
    segmentPaths.push(finalSegPath);
    // Emit per-segment callback for progressive upload if provided
    if (typeof params?.onSegment === 'function') {
      try { await params.onSegment(index, finalSegPath); } catch (_) {}
    }
    index++;
  }
  if (typeof onProgress === 'function') onProgress(85);
  return { segmentPaths };
};

