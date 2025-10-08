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
    const paragraphs = groupSrtIntoParagraphs(sentences, num, minSeconds, maxSeconds);
    return res.json({ paragraphs });
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
    const videoFile = req.file;
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
      await ffmpegTrim(videoFile.path, startMs, endMs, rawSegPath);

      // Normalize to 9:16 portrait first
      await ffmpegNormalizePortrait(rawSegPath, portraitSegPath);
      try { fs.unlinkSync(rawSegPath); } catch {}

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
            let cmd = ffmpeg().input(portraitSegPath);
            cmd = cmd.complexFilter(drawFilters).outputOptions(['-map', '[vout]', '-map', '0:a?']);
            cmd
              .videoCodec('libx264')
              .audioCodec('aac')
              .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
              .on('error', reject)
              .on('end', resolve)
              .save(finalSegPath);
          });h
          // keep finalSegPath
        } else {
          try { fs.copyFileSync(portraitSegPath, finalSegPath); } catch {}
        }
      } else {
        try { fs.copyFileSync(portraitSegPath, finalSegPath); } catch {}
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

    return res.json({
      success: true,
      jobId,
      segments: segmentsMeta.map(({ index, startMs, endMs, url }) => ({ index, startMs, endMs, url }))
    });
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


