const { createClient } = require("@deepgram/sdk");
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeStatic = require('ffprobe-static');

try {
  if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  }
  if (ffprobeStatic && ffprobeStatic.path) {
    ffmpeg.setFfprobePath(ffprobeStatic.path);
  }
} catch (_) {}

// Hinglish transliteration: Devanagari -> Latin
const independentVowels = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o'
};
const vowelSigns = {
  'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au'
};
const consonants = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y'
};
const anusvaraLike = { 'ं': 'n', 'ँ': 'n' };
const visarga = { 'ः': 'h' };
const virama = '्';
const nukta = '़';

function isDevanagari(ch) {
  const code = ch.charCodeAt(0);
  return (code >= 0x0900 && code <= 0x097F) || (code >= 0xA8E0 && code <= 0xA8FF);
}

function transliterateToEnglish(text) {
  if (!text || typeof text !== 'string') return text;
  let out = '';
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (!isDevanagari(ch)) { out += ch; continue; }
    if (independentVowels[ch]) {
      out += independentVowels[ch];
      const nxt = text[i + 1];
      if (anusvaraLike[nxt]) { out += anusvaraLike[nxt]; i++; }
      else if (visarga[nxt]) { out += visarga[nxt]; i++; }
      continue;
    }
    let baseConsonant = ch;
    let j = i + 1;
    if (text[j] === nukta && consonants[baseConsonant + nukta]) {
      baseConsonant = baseConsonant + nukta;
      j++;
    }
    if (consonants[baseConsonant]) {
      let syllable = consonants[baseConsonant];
      let hasHalant = false;
      while (text[j] === virama) {
        hasHalant = true;
        j++;
        let nextCons = text[j];
        if (!nextCons) break;
        if (text[j + 1] === nukta && consonants[nextCons + nukta]) {
          nextCons = nextCons + nukta;
          j++;
        }
        if (consonants[nextCons]) {
          syllable += consonants[nextCons];
          j++;
          hasHalant = false;
        } else {
          break;
        }
      }
      const sign = text[j];
      if (vowelSigns[sign]) { syllable += vowelSigns[sign]; j++; }
      else if (!hasHalant) { syllable += 'a'; }
      const nasalOrVisarga = text[j];
      if (anusvaraLike[nasalOrVisarga]) { syllable += anusvaraLike[nasalOrVisarga]; j++; }
      else if (visarga[nasalOrVisarga]) { syllable += visarga[nasalOrVisarga]; j++; }
      out += syllable;
      i = j - 1;
      continue;
    }
    if (vowelSigns[ch]) { out += vowelSigns[ch]; continue; }
    if (anusvaraLike[ch]) { out += anusvaraLike[ch]; continue; }
    if (visarga[ch]) { out += visarga[ch]; continue; }
    if (ch === virama || ch === nukta) { continue; }
    out += ch;
  }
  return out;
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")},${milliseconds.toString().padStart(3, "0")}`;
}

function convertToWordSRT(result) {
  try {
    let allWords = [];
    if (
      result?.results?.channels?.[0]?.alternatives?.[0]?.words &&
      result.results.channels[0].alternatives[0].words.length > 0
    ) {
      allWords = result.results.channels[0].alternatives[0].words;
    } else if (
      result?.results?.alternatives?.[0]?.words &&
      result.results.alternatives[0].words.length > 0
    ) {
      allWords = result.results.alternatives[0].words;
    }
    if (allWords.length === 0) return "";

    let srtContent = "";
    let captionIndex = 1;
    const wordsPerCaption = 4;

    for (let i = 0; i < allWords.length; i += wordsPerCaption) {
      const wordGroup = allWords.slice(i, i + wordsPerCaption);
      if (wordGroup.length === 0) continue;

      const startTime = wordGroup[0].start;
      const endTime = wordGroup[wordGroup.length - 1].end;
      const captionText = wordGroup.map(w => w.punctuated_word || w.word).join(' ');

      if (String(captionText).trim()) {
        srtContent += `${captionIndex}\n`;
        srtContent += `${formatTime(startTime)} --> ${formatTime(endTime)}\n`;
        srtContent += `${captionText.trim()}\n\n`;
        captionIndex++;
      }
    }
    return srtContent;
  } catch (_) {
    return "";
  }
}

// --- Helpers for drawtext overlay (reference: videoToReelsController) ---
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
const resolveFontPath = (fontKey) => {
  const key = (fontKey || 'notosans').toLowerCase();
  const candidate = FONT_MAP[key] || FONT_MAP.notosans;
  return fs.existsSync(candidate) ? candidate : null;
};
const cleanTextForDrawtext = (text) => {
  if (!text) return '';
  return String(text)
    .replace(/\r\n/g, ' ')
    .replace(/[\r\n]/g, ' ')
    .replace(/['"]/g, '')
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
};
const sanitizeBackgroundColor = (input, fallback, alpha) => {
  const a = Math.min(1, Math.max(0, Number(alpha) || 0));
  const fb = fallback || 'black';
  if (!input) return `${fb}@${a}`;
  const val = String(input).trim();
  // Accept hex like #RRGGBB or #rrggbb
  if (/^#([0-9a-fA-F]{6})$/.test(val)) {
    return `${val}@${a}`;
  }
  // Accept a few named colors
  const named = ['black','white','red','green','blue','yellow','cyan','magenta','gray','grey'];
  if (named.includes(val.toLowerCase())) {
    return `${val.toLowerCase()}@${a}`;
  }
  return `${fb}@${a}`;
};

const buildDrawtextFilter = (text, fontKey, position = 'bottom', textColor = 'white', boxOpacity = 0.35, backgroundColor) => {
  const yExpr = position === 'top' ? `120` : (position === 'middle' ? `(h-text_h)/2` : `h-(text_h+220)`);
  const isWhiteText = textColor === 'white';
  const fontColor = isWhiteText ? '0xFDFDFD' : '0x000000';
  const borderColor = isWhiteText ? '0x000000' : '0xFFFFFF';
  const shadowColor = isWhiteText ? '0x000000AA' : '0xFFFFFFAA';
  const alpha = Math.min(1, Math.max(0, Number(boxOpacity) || 0));
  const boxColor = sanitizeBackgroundColor(backgroundColor, isWhiteText ? 'black' : 'white', alpha);
  const base = [
    `text='${text}'`,
    `fontcolor=${fontColor}`,
    `fontsize=56`,
    `borderw=2`,
    `bordercolor=${borderColor}`,
    `shadowcolor=${shadowColor}`,
    `shadowx=2`,
    `shadowy=2`,
    `box=1`,
    `boxcolor=${boxColor}`,
    `boxborderw=12`,
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
};

// Parse SRT entries (simple)
function parseSRT(srtContent) {
  const entries = [];
  const normalized = String(srtContent || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return entries;
  const blocks = normalized.split('\n\n');
  blocks.forEach((block) => {
    const lines = block.split('\n');
    if (lines.length >= 2) {
      const timeLine = lines[1];
      const text = lines.slice(2).join(' ').trim();
      const m = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
      if (m && text) {
        const start = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 1000;
        const end = parseInt(m[5]) * 3600 + parseInt(m[6]) * 60 + parseInt(m[7]) + parseInt(m[8]) / 1000;
        entries.push({ start, end, text });
      }
    }
  });
  return entries;
}

// Generate a video with word-level SRT overlaid
async function generateVideoWithWordSrt(req, res) {
  try {
    const uploadedFile = req.file;
    const wordSrt = req.body?.wordSrt;
    const fontKeyFromReq = (req.body?.fontKey || '').toString().toLowerCase();
    const allowedFonts = ['khand','notosans','poppins','amaticsc','bebasneue','comfortaa','exo2italic','orbitron','pacifico','shadowsintolight'];
    const selectedFontKey = allowedFonts.includes(fontKeyFromReq) ? fontKeyFromReq : 'notosans';
    const textColorFromReq = (req.body?.textColor || 'white').toString().toLowerCase();
    const selectedTextColor = ['white','black'].includes(textColorFromReq) ? textColorFromReq : 'white';
    const rawOpacity = (req.body && req.body.boxOpacity != null) ? Number(req.body.boxOpacity) : undefined;
    const selectedBoxOpacity = isFinite(rawOpacity) ? Math.min(1, Math.max(0, rawOpacity)) : 0.35;
    const textPositionFromReq = (req.body?.textPosition || '').toString().toLowerCase();
    const selectedTextPosition = ['top','middle','bottom'].includes(textPositionFromReq) ? textPositionFromReq : 'bottom';
    const backgroundColorFromReq = (req.body?.backgroundColor || '').toString();

    if (!uploadedFile || !uploadedFile.path) {
      return res.status(400).json({ error: 'Video file is required' });
    }
    if (!wordSrt || typeof wordSrt !== 'string' || wordSrt.trim().length === 0) {
      return res.status(400).json({ error: 'wordSrt is required' });
    }

    const entries = parseSRT(wordSrt);
    if (entries.length === 0) {
      return res.status(400).json({ error: 'No entries in SRT' });
    }

    // Base: normalize to portrait 1080x1920 before text overlay
    const filters = [
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)/2:(ih-1920)/2[base]'
    ];
    // Build drawtext filters across entire timeline
    let lastLabel = 'base';
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const clean = cleanTextForDrawtext(e.text);
      if (!clean) continue;
      const pos = selectedTextPosition;
      const draw = buildDrawtextFilter(clean, selectedFontKey, pos, selectedTextColor, selectedBoxOpacity, backgroundColorFromReq);
      const outLabel = (i === entries.length - 1) ? 'vout' : `v${i}`;
      filters.push(`[${lastLabel}]${draw}:enable='between(t,${e.start.toFixed(3)},${e.end.toFixed(3)})'[${outLabel}]`);
      lastLabel = outLabel;
    }

    const workDir = path.join('temp', 'subtitles');
    fs.mkdirSync(workDir, { recursive: true });
    const outPath = path.join(workDir, `sub_${Date.now()}.mp4`);

    await new Promise((resolve, reject) => {
      let cmd = ffmpeg();
      cmd = cmd.input(uploadedFile.path);
      if (filters.length > 0) {
        cmd = cmd.complexFilter(filters).outputOptions(['-map', '[vout]', '-map', '0:a?']);
      }
      cmd
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
        .on('error', (e) => reject(e))
        .on('end', resolve)
        .save(outPath);
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="subtitled.mp4"');
    const stream = fs.createReadStream(outPath);
    stream.on('close', () => {
      try { fs.unlinkSync(outPath); } catch(_) {}
      try { fs.unlinkSync(uploadedFile.path); } catch(_) {}
    });
    stream.pipe(res);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate video with subtitles', details: err.message });
  }
}

async function generateWordSrt(req, res) {
  try {
    const audioBase64 = req.body && req.body.audio;
    if (!audioBase64) {
      return res.status(400).json({ error: "Audio (base64) is required" });
    }
    if (!process.env.DEEPGRAM_API_KEY) {
      return res.status(500).json({ error: "Deepgram API key not configured" });
    }

    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
    // Detect mimetype from data URL if present (fallback to audio/mpeg)
    const m = String(audioBase64).match(/^data:(audio\/[a-zA-Z0-9+.-]+);base64,/);
    const detectedMime = m && m[1] ? m[1] : 'audio/mpeg';
    const base64Data = String(audioBase64).replace(/^data:audio\/[^;]+;base64,/, "");
    const audioBuffer = Buffer.from(base64Data, "base64");

    const transcriptionOptions = {
      model: "nova-2",
      language: "hi",
      detect_language: false,
      smart_format: true,
      utterances: true,
      punctuate: true,
      diarize: false,
      timestamps: true,
    };

    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      { mimetype: detectedMime, ...transcriptionOptions }
    );

    if (error) {
      console.error('[WordSRT] Deepgram error:', error);
      return res.status(500).json({ error: "Transcription failed", details: error.message || String(error) });
    }
    if (!result) {
      return res.status(500).json({ error: "No transcription result received" });
    }

    const srtContent = convertToWordSRT(result);
    if (!srtContent || srtContent.trim().length === 0) {
      return res.status(500).json({ error: "Failed to generate SRT captions" });
    }

    const englishSrtContent = transliterateToEnglish(srtContent);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="captions_words.srt"');
    res.send(englishSrtContent);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
}

module.exports = { generateWordSrt, generateVideoWithWordSrt };
