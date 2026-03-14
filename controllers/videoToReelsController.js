const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeStatic = require("ffprobe-static");
const { createClient } = require("@deepgram/sdk");
const fetch = require("node-fetch");

// Utility function to sanitize and truncate filenames
const sanitizeFilename = (filename, maxLength = 50) => {
  if (!filename || typeof filename !== 'string') {
    return `video_${Date.now()}`;
  }
  
  // Remove extension first
  const ext = path.extname(filename);
  const nameWithoutExt = path.basename(filename, ext);
  
  // Sanitize: remove special characters, keep only alphanumeric, spaces, hyphens, underscores
  const sanitized = nameWithoutExt
    .replace(/[^\w\s\-_]/g, '') // Remove special characters except word chars, spaces, hyphens, underscores
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .substring(0, maxLength - ext.length) // Truncate to fit within maxLength including extension
    .replace(/_+$/, ''); // Remove trailing underscores
  
  // Ensure we have a valid name
  const finalName = sanitized || `video_${Date.now()}`;
  return finalName + ext;
};

// Font configuration for text overlay
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

// Enhanced text cleaning function for FFmpeg drawtext with Hindi support
const cleanTextForDrawtext = (text) => {
  if (!text) return '';
  
  return text
    // Replace newlines and carriage returns
    .replace(/\r\n/g, ' ')
    .replace(/[\r\n]/g, ' ')
    // Remove or replace problematic characters for FFmpeg
    .replace(/['"]/g, '') // Remove quotes entirely
    .replace(/:/g, ' ') // Replace colons with spaces
    .replace(/;/g, ',') // Replace semicolons with commas
    .replace(/\\/g, '/') // Replace backslashes with forward slashes
    .replace(/\[/g, '(') // Replace square brackets
    .replace(/\]/g, ')')
    .replace(/\{/g, '(') // Replace curly brackets
    .replace(/\}/g, ')')
    .replace(/%/g, 'percent') // Replace percent signs
    .replace(/=/g, ' equals ') // Replace equals signs
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
};

// Build drawtext filter using selected bundled font when available
const buildDrawtextFilter = (text, fontKey, position = 'bottom', textColor = 'white', backgroundColor = undefined) => {
  const yExpr = position === 'top' ? `120` : `h-(text_h+220)`;
  
                             
  // Determine text color and background based on textColor parameter
  const isWhiteText = textColor === 'white';
  const fontColor = isWhiteText ? '0xFDFDFD' : '0x000000';
  const borderColor = isWhiteText ? '0x000000' : '0xFFFFFF';
  const shadowColor = isWhiteText ? '0x000000AA' : '0xFFFFFFAA';
  // If backgroundColor is provided as 'white' or 'black', honor it; else default to opposite of text for contrast
  const bg = (typeof backgroundColor === 'string' && ['white','black'].includes(backgroundColor.toLowerCase()))
    ? backgroundColor.toLowerCase()
    : (isWhiteText ? 'black' : 'white');
  const boxColor = `${bg}@0.35`;
  
  // Modern, high-contrast styling with configurable colors
  const base = [
    `text='${text}'`,
    `fontcolor=${fontColor}`,
    `fontsize=72`,
    // Outline for readability
    `borderw=2`,
    `bordercolor=${borderColor}`,
    // Soft shadow for depth
    `shadowcolor=${shadowColor}`,
    `shadowx=2`,
    `shadowy=2`,
    // Subtle translucent background box to improve contrast on busy footage
    `box=1`,
    `boxcolor=${boxColor}`,
    `boxborderw=16`,
    // Placement and spacing
    `x=(w-text_w)/2`,
    `y=${yExpr}`,
    `line_spacing=12`
  ].join(':');
  const fontPath = resolveFontPath(fontKey);
  if (fontPath) {
    // Use fontfile to avoid fontconfig/system fonts
    const fontPathUnix = fontPath.replace(/\\/g, '/');
    return `drawtext=fontfile='${fontPathUnix}':${base}`;
  }
  // Fallback to system font discovery if bundled font missing
  console.warn('[drawtext] Bundled font not found for key', fontKey, 'falling back to system fonts');
  return `drawtext=${base}`;
};

// Hinglish transliteration: Devanagari -> Latin with matras, virama, inherent vowel
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

    // Non-Devanagari: copy as is
    if (!isDevanagari(ch)) {
      out += ch;
      continue;
    }

    // Independent vowels
    if (independentVowels[ch]) {
      out += independentVowels[ch];
      // Possible anusvara/chandrabindu/visarga after vowel
      const nxt = text[i + 1];
      if (anusvaraLike[nxt]) { out += anusvaraLike[nxt]; i++; }
      else if (visarga[nxt]) { out += visarga[nxt]; i++; }
      continue;
    }

    // Consonant sequence handling with possible nukta
    let baseConsonant = ch;
    let j = i + 1;
    // Combine nukta if present
    if (text[j] === nukta && consonants[baseConsonant + nukta]) {
      baseConsonant = baseConsonant + nukta;
      j++;
    }

    if (consonants[baseConsonant]) {
      let syllable = consonants[baseConsonant];
      let hasHalant = false;

      // Handle consonant clusters: (virama + consonant)*
      while (text[j] === virama) {
        hasHalant = true;
        j++;
        // next consonant (with optional nukta)
        let nextCons = text[j];
        if (!nextCons) break;
        if (text[j + 1] === nukta && consonants[nextCons + nukta]) {
          nextCons = nextCons + nukta;
          j++;
        }
        if (consonants[nextCons]) {
          syllable += consonants[nextCons];
          j++;
          hasHalant = false; // reset; may get another virama next
        } else {
          break;
        }
      }

      // Vowel sign after cluster
      const sign = text[j];
      if (vowelSigns[sign]) {
        syllable += vowelSigns[sign];
        j++;
      } else if (!hasHalant) {
        // inherent 'a' if no halant and no vowel sign
        syllable += 'a';
      }

      // Anusvara/Chandrabindu/Visarga after syllable
      const nasalOrVisarga = text[j];
      if (anusvaraLike[nasalOrVisarga]) { syllable += anusvaraLike[nasalOrVisarga]; j++; }
      else if (visarga[nasalOrVisarga]) { syllable += visarga[nasalOrVisarga]; j++; }

      out += syllable;
      i = j - 1; // advance
      continue;
    }

    // Vowel signs alone (shouldn't occur normally) or other marks
    if (vowelSigns[ch]) { out += vowelSigns[ch]; continue; }
    if (anusvaraLike[ch]) { out += anusvaraLike[ch]; continue; }
    if (visarga[ch]) { out += visarga[ch]; continue; }
    // virama alone -> skip
    if (ch === virama || ch === nukta) { continue; }

    // Fallback: copy
    out += ch;
  }
  return out;
}


const IMAGE_VIDEO_DURATION = 2; // seconds for each image overlay window

// Overlay functionality removed: no drawtext helpers or font handling

try {
  if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  }
  if (ffprobeStatic && ffprobeStatic.path) {
    ffmpeg.setFfprobePath(ffprobeStatic.path);
  }
} catch (err) {
  console.error('❌ FFmpeg setup failed:', err.message);
}

// Extract audio from an uploaded video and stream back as MP3
async function extractAudio(req, res) {
  console.log('[extractAudio] Starting audio extraction...');
  
  try {
    const uploadedFile = req.file;
    if (!uploadedFile) {
      console.error('[extractAudio] No file uploaded');
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return res.status(400).json({ message: "No video file uploaded" });
    }

    console.log('[extractAudio] File received:', {
      originalname: uploadedFile.originalname,
      mimetype: uploadedFile.mimetype,
      size: uploadedFile.size,
      path: uploadedFile.path
    });

    const inputPath = uploadedFile.path; // temp upload path from multer
    
    // Validate input file exists
    if (!fs.existsSync(inputPath)) {
      console.error('[extractAudio] Input file does not exist:', inputPath);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return res.status(400).json({ message: "Uploaded file not found" });
    }

    // Check file size and permissions
    const stats = fs.statSync(inputPath);
    console.log('[extractAudio] File stats:', {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      mode: stats.mode
    });

    const sanitizedOriginalName = sanitizeFilename(uploadedFile.originalname, 30);
    const outputFileName = `${path.parse(sanitizedOriginalName).name}-${Date.now()}.mp3`;
    const outputPath = path.join("temp", outputFileName);

    // Ensure temp directory exists
    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      console.log('[extractAudio] Temp directory created/verified:', path.dirname(outputPath));
    } catch (dirErr) {
      console.error('[extractAudio] Failed to create temp directory:', dirErr.message);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return res.status(500).json({ message: "Failed to create temp directory", error: dirErr.message });
    }

    console.log('[extractAudio] Processing:', {
      inputPath,
      outputPath,
      originalName: uploadedFile.originalname,
      sanitizedName: sanitizedOriginalName,
      outputFileName
    });

    // Check FFmpeg availability
    console.log('[extractAudio] FFmpeg path:', ffmpegInstaller?.path);
    console.log('[extractAudio] FFprobe path:', ffprobeStatic?.path);

    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("192k")
      .on("start", (commandLine) => {
        console.log('[extractAudio] FFmpeg started:', commandLine);
      })
      .on("progress", (progress) => {
        console.log('[extractAudio] FFmpeg progress:', progress.percent + '% done');
      })
      .on("error", (err) => {
        console.error('[extractAudio] FFmpeg error details:', {
          message: err.message,
          stack: err.stack,
          code: err.code,
          signal: err.signal
        });
        safeCleanup([inputPath, outputPath]);
        if (!res.headersSent) {
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
          return res.status(500).json({ message: "Audio extraction failed", error: err.message });
        }
      })
      .on("end", () => {
        console.log('[extractAudio] FFmpeg completed successfully');
        
        // Verify output file exists
        if (!fs.existsSync(outputPath)) {
          console.error('[extractAudio] Output file was not created:', outputPath);
          safeCleanup([inputPath]);
          if (!res.headersSent) {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
            return res.status(500).json({ message: "Audio extraction failed - output file not created" });
          }
          return;
        }

        const outputStats = fs.statSync(outputPath);
        console.log('[extractAudio] Output file created:', {
          path: outputPath,
          size: outputStats.size
        });

        // Check if response has already been sent
        if (res.headersSent) {
          console.log('[extractAudio] Response already sent, skipping stream');
          safeCleanup([inputPath, outputPath]);
          return;
        }

        try {
          res.setHeader("Content-Type", "audio/mpeg");
          res.setHeader("Content-Disposition", `inline; filename="${outputFileName}"`);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

          const stream = fs.createReadStream(outputPath);
          stream.on("close", () => {
            console.log('[extractAudio] Stream closed, cleaning up files');
            safeCleanup([inputPath, outputPath]);
          });
          stream.on("error", (streamErr) => {
            console.error('[extractAudio] Stream error:', streamErr.message);
            safeCleanup([inputPath, outputPath]);
            if (!res.headersSent) {
              res.setHeader("Access-Control-Allow-Origin", "*");
              res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
              res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
              res.status(500).json({ message: "Stream error", error: streamErr.message });
            }
          });
          stream.pipe(res);
        } catch (streamError) {
          console.error('[extractAudio] Error setting up stream:', streamError.message);
          safeCleanup([inputPath, outputPath]);
          if (!res.headersSent) {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
            res.status(500).json({ message: "Stream setup error", error: streamError.message });
          }
        }
      })
      .save(outputPath);
  } catch (error) {
    console.error('[extractAudio] Unexpected error:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    safeCleanup([req?.file?.path]);
    if (!res.headersSent) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return res.status(500).json({ message: "Unexpected error", error: error.message });
    }
  }
}

function safeCleanup(paths) {
  for (const p of paths) {
    if (!p) continue;
    fs.promises
      .unlink(p)
      .catch(() => {});
  }
}

module.exports = { extractAudio };

// Generate sentence-level SRT from base64 audio using Deepgram
async function generateSentenceSrt(req, res) {
  try {
    const audioBase64 = req.body && req.body.audio;
    if (!audioBase64) {
      return res.status(400).json({ error: "Audio (base64) is required" });
    }

    if (!process.env.DEEPGRAM_API_KEY) {
      return res.status(500).json({ error: "Deepgram API key not configured" });
    }

  const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

    // Strip data URL prefix if present
    const base64Data = String(audioBase64).replace(/^data:audio\/[^;]+;base64,/, "");
    const audioBuffer = Buffer.from(base64Data, "base64");

    const transcriptionOptions = {
      model: "nova-2",
      smart_format: true,
      utterances: true,
      punctuate: true,
      diarize: false,
      timestamps: true,
      paragraphs: true,
      // Recognize Hindi for accuracy; we'll transliterate to Hinglish
      language: "hi",
      detect_language: false,
    };

    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      { mimetype: "audio/mp3", ...transcriptionOptions }
    );

    if (error) {
      return res.status(500).json({ error: "Transcription failed", details: error.message || error });
    }
    if (!result) {
      return res.status(500).json({ error: "No transcription result received" });
    }

    const srtContent = convertToSRT(result);
    if (!srtContent || srtContent.trim().length === 0) {
      return res.status(500).json({ error: "Failed to generate SRT captions" });
    }

    // Ensure final content is in English (transliterate any Devanagari to Latin)
    const englishSrtContent = transliterateToEnglish(srtContent);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="captions.srt"');
    res.send(englishSrtContent);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
}

function convertToSRT(result) {
  try {
    let allWords = [];
    // Prefer channelized words
    if (
      result?.results?.channels?.[0]?.alternatives?.[0]?.words &&
      result.results.channels[0].alternatives[0].words.length > 0
    ) {
      allWords = result.results.channels[0].alternatives[0].words;
    } else if (
      // Fallback: some responses provide results.alternatives
      result?.results?.alternatives?.[0]?.words &&
      result.results.alternatives[0].words.length > 0
    ) {
      allWords = result.results.alternatives[0].words;
    }
    if (allWords.length === 0) return "";

    // Build captions of 10-15 words per block for readability
    const minWords = 10;
    const maxWords = 15;
    let srt = "";
    let idx = 1;
    for (let i = 0; i < allWords.length; ) {
      // Ensure at least minWords, up to maxWords or until a natural sentence end
      let endIdx = Math.min(allWords.length, i + minWords);
      // Try to extend up to maxWords while staying within limit
      while (endIdx < Math.min(allWords.length, i + maxWords)) {
        endIdx++;
      }
      const chunk = allWords.slice(i, endIdx);
      if (chunk.length === 0) break;
      const startTime = chunk[0].start;
      const endTime = chunk[chunk.length - 1].end;
      const captionText = chunk.map(w => w.punctuated_word || w.word).join(' ');
      if (String(captionText).trim()) {
        srt += `${idx}\n`;
        srt += `${formatTime(startTime)} --> ${formatTime(endTime)}\n`;
        srt += `${captionText.trim()}\n\n`;
        idx++;
      }
      i = endIdx;
    }
    return srt;
  } catch (_) {
    return "";
  }
}

function groupWordsIntoSentences(words) {
  const sentences = [];
  let current = { words: [], text: "" };
  const sentenceEnders = /[.!?]/;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const punctuated = word.punctuated_word || word.word;
    current.words.push(word);
    current.text += (current.text ? " " : "") + punctuated;

    if (sentenceEnders.test(punctuated)) {
      const isAbbrev = /\b[A-Z][a-z]?\.$/.test(punctuated) && i < words.length - 1 && !/^[A-Z]/.test((words[i + 1].punctuated_word || words[i + 1].word));
      if (!isAbbrev) {
        sentences.push({ ...current });
        current = { words: [], text: "" };
        continue;
      }
    }

    if (i < words.length - 1) {
      const gap = words[i + 1].start - word.end;
      if (gap > 2.0 && current.words.length > 0) {
        sentences.push({ ...current });
        current = { words: [], text: "" };
      }
    }
  }

  if (current.words.length > 0) sentences.push(current);

  const merged = [];
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (s.words.length < 3 && merged.length > 0) {
      const prev = merged[merged.length - 1];
      prev.words = [...prev.words, ...s.words];
      prev.text = prev.text + " " + s.text;
    } else if (s.words.length < 3 && i < sentences.length - 1) {
      const next = sentences[i + 1];
      next.words = [...s.words, ...next.words];
      next.text = s.text + " " + next.text;
    } else {
      merged.push(s);
    }
  }
  return merged.length > 0 ? merged : sentences;
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

module.exports.generateSentenceSrt = generateSentenceSrt;

// Generate word-level SRT (fixed-size word chunks) from base64 audio using Deepgram
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

    const base64Data = String(audioBase64).replace(/^data:audio\/[^;]+;base64,/, "");
    const audioBuffer = Buffer.from(base64Data, "base64");

    const transcriptionOptions = {
      model: "nova-2",
      // Recognize Hindi for accuracy; we'll transliterate to Hinglish
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
      { mimetype: "audio/mp3", ...transcriptionOptions }
    );

    if (error) {
      return res.status(500).json({ error: "Transcription failed", details: error.message || error });
    }
    if (!result) {
      return res.status(500).json({ error: "No transcription result received" });
    }

    const srtContent = convertToWordSRT(result);
    if (!srtContent || srtContent.trim().length === 0) {
      return res.status(500).json({ error: "Failed to generate SRT captions" });
    }

    // Ensure final content is in English (transliterate any Devanagari to Latin)
    const englishSrtContent = transliterateToEnglish(srtContent);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="captions_words.srt"');
    res.send(englishSrtContent);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
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
    const wordsPerCaption = 4; // chunk size adjusted to 4

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

module.exports.generateWordSrt = generateWordSrt;

// Generate important sentences (ordered) and group into N paragraphs within a time window
async function generateImportantSentences(req, res) {
  try {
    const { srt, count } = req.body || {};
    // Optional time range target in seconds for combined speaking time
    let minSeconds = Number.parseInt(req.body?.minSeconds, 10);
    let maxSeconds = Number.parseInt(req.body?.maxSeconds, 10);
    if (!Number.isFinite(minSeconds) || minSeconds <= 0) minSeconds = 30;
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) maxSeconds = 35;
    if (minSeconds > maxSeconds) { const t = minSeconds; minSeconds = maxSeconds; maxSeconds = t; }
    if (!srt || typeof srt !== 'string' || srt.trim().length === 0) {
      return res.status(400).json({ error: "SRT content is required" });
    }

    const targetCount = Math.min(Math.max(parseInt(count || 5, 10) || 5, 1), 10);

    // Parse and group SRT to sentences
    const entries = parseSRT(srt);
    console.log('[VTR] Parsed SRT entries:', entries.length);
    const grouped = groupSRTIntoSentencesFromEntries(entries);
    console.log('[VTR] Grouped sentences:', grouped.length);
    const sentences = grouped.map(g => (g.text || '').trim()).filter(Boolean);
    console.log('[VTR] Filtered sentences:', sentences.length, sentences.slice(0, 3));
    if (sentences.length === 0) {
      return res.status(400).json({ error: 'No sentences found in SRT' });
    }

    // Build prompt
    const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const body = {
      model: 'anthropic/claude-3-haiku',
      messages: [
        {
          role: 'user',
          content:
            `You are given a transcript split into ordered sentences (with story flow).\n` +
            `Pick exactly ${targetCount} of the most important, high-signal sentences for a short reel.\n` +
            `CRITICAL RULES:\n` +
            `- Preserve the original order of appearance (keep sequence).\n` +
            `- Sentences MUST be short and concise (roughly 8–15 words each).\n` +
            `- Aim for a combined speaking time between ${minSeconds} and ${maxSeconds} seconds in total.\n` +
            `- Prefer hooks, key insights, turning points, or self-contained bits.\n` +
            `- Avoid near-duplicates, filler, intros/outros, and overly short fragments.\n` +
            `Return STRICT JSON: { "sentences": ["...", "...", "..."] } with exactly ${targetCount} items.\n\n` +
            `Sentences:\n${numbered}`
        }
      ],
      max_tokens: 800,
      temperature: 0.4
    };

    let important = [];
    if (process.env.OPENROUTER_API_KEY) {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (resp.ok) {
        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content || '{}';
        try {
          const parsed = JSON.parse(content);
          if (parsed && Array.isArray(parsed.sentences)) {
            important = parsed.sentences.map(s => String(s).trim()).filter(Boolean);
          }
        } catch (_) {}
      }
    }

    // Build paragraphs constrained by time per paragraph (minSeconds..maxSeconds)
    // Strategy: map transcript sentences to durations, then assign in order across N paragraphs
    const allEntries = parseSRT(srt);
    const groupedEntries = groupSRTIntoSentencesFromEntries(allEntries);
    const sentenceDurations = groupedEntries.map(g => ({
      text: (g.text || '').trim(),
      dur: Math.max(0, (g.endTime || 0) - (g.startTime || 0))
    }));
    const avgDur = sentenceDurations.length
      ? sentenceDurations.reduce((s, x) => s + x.dur, 0) / sentenceDurations.length
      : 2.5;
    const findDur = (t) => {
      const norm = normalizeText(t);
      const m = sentenceDurations.find(x => normalizeText(x.text) === norm || normalizeText(x.text).includes(norm) || norm.includes(normalizeText(x.text)));
      return m ? m.dur : avgDur;
    };

    // If AI didn't provide any selection, use all sentences in order
    const sourceList = Array.isArray(important) && important.length > 0 ? important : sentences;
    // Map each chosen sentence back to its index in groupedEntries (best match)
    const indexForSentence = (t) => {
      const nt = normalizeText(t);
      let best = { idx: -1, score: 0 };
      for (let i = 0; i < groupedEntries.length; i++) {
        const ne = normalizeText(groupedEntries[i].text || '');
        if (!ne) continue;
        const contains = nt.includes(ne) || ne.includes(nt);
        const score = contains ? 1 : jaccardSimilarity(nt, ne);
        if (score > best.score) best = { idx: i, score };
      }
      return best.idx;
    };
    const sourceIndexes = sourceList.map(s => indexForSentence(s)).filter(i => i >= 0);

    const paragraphs = [];
    const paragraphIndices = [];
    let current = [];
    let currentDur = 0;
    let currentIdxs = [];
    for (let i = 0; i < sourceList.length && paragraphs.length < targetCount; i++) {
      const sent = String(sourceList[i]).trim();
      if (!sent) continue;
      const d = findDur(sent);
      // Always add at least one sentence to a paragraph
      current.push(sent);
      currentDur += d;
      currentIdxs.push(sourceIndexes[i] ?? -1);
      // Close paragraph if we reached minSeconds, or if adding next would exceed maxSeconds significantly
      if (currentDur >= minSeconds || currentDur >= maxSeconds) {
        paragraphs.push(current);
        paragraphIndices.push(currentIdxs.filter(x => x >= 0));
        current = [];
        currentDur = 0;
        currentIdxs = [];
      }
    }
    if (paragraphs.length < targetCount && current.length > 0) {
      paragraphs.push(current);
      paragraphIndices.push(currentIdxs.filter(x => x >= 0));
    }
    // Ensure exactly targetCount paragraphs
    while (paragraphs.length < targetCount) { paragraphs.push([]); paragraphIndices.push([]); }
    if (paragraphs.length > targetCount) paragraphs.length = targetCount;

    // Flatten for backward compatibility
    const flatSentences = sourceList;

    return res.json({ paragraphs, paragraphIndices, sentences: flatSentences });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate important sentences', details: err.message });
  }
}

function parseSRT(srtContent) {
  const entries = [];
  const normalized = String(srtContent).replace(/\r\n/g, '\n');
  
  // Handle malformed SRT where everything is on one line
  // Look for pattern: number + timestamp + text + number + timestamp + text...
  const malformedPattern = /(\d+)\s+(\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3})\s+([^0-9]+?)(?=\s+\d+\s+\d{2}:\d{2}:\d{2},\d{3}|$)/g;
  
  let match;
  while ((match = malformedPattern.exec(normalized)) !== null) {
    const timeLine = match[2];
    const text = match[3].trim();
    const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    
    if (timeMatch && text.length > 0) {
      const startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
      const endTime = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
      entries.push({ startTime, endTime, text });
      console.log(`[VTR] Added malformed entry:`, text.substring(0, 50) + '...');
    }
  }
  
  // If malformed parsing didn't work, try normal parsing
  if (entries.length === 0) {
    console.log('[VTR] Trying normal SRT parsing...');
    const blocks = normalized.trim().split('\n\n');
    console.log('[VTR] SRT blocks count:', blocks.length);
    
    blocks.forEach((block, blockIdx) => {
      const lines = block.split('\n');
      console.log(`[VTR] Block ${blockIdx} lines:`, lines.length, lines);
      
      if (lines.length >= 2) {
        const timeLine = lines[1];
        const text = lines.slice(2).join(' ').trim();
        const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
        if (timeMatch && text.length > 0) {
          const startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
          const endTime = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
          entries.push({ startTime, endTime, text });
          console.log(`[VTR] Added normal entry:`, text.substring(0, 50) + '...');
        }
      }
    });
  }
  
  return entries;
}

function groupSRTIntoSentencesFromEntries(entries) {
  const sentences = [];
  let current = null;
  entries.forEach((entry, idx) => {
    const text = (entry.text || '').trim();
    // Enhanced sentence ending detection for Hindi and mixed content
    const endsSentence = /[.!?।॥]$/.test(text) || text.length > 50; // Hindi full stop (।) and double danda (॥)
    if (!current) {
      current = { startTime: entry.startTime, endTime: entry.endTime, text: text };
    } else {
      current.endTime = entry.endTime;
      if (text.length > 0) current.text += (current.text ? ' ' : '') + text;
    }
    if (endsSentence || idx === entries.length - 1) {
      const minWords = 2; // Reduced minimum words for Hindi content
      const wc = (current.text || '').split(/\s+/).filter(Boolean).length;
      if (wc < minWords && sentences.length > 0) {
        sentences[sentences.length - 1].endTime = current.endTime;
        sentences[sentences.length - 1].text = `${sentences[sentences.length - 1].text} ${current.text}`.trim();
      } else {
        sentences.push(current);
      }
      current = null;
    }
  });
  return sentences;
}

module.exports.generateImportantSentences = generateImportantSentences;

// Generate up to N image prompts for a single paragraph using OpenRouter
async function generateImagePromptsForParagraph(req, res) {
  try {
    const paragraph = (req.body && req.body.paragraph) || '';
    const maxVariants = Math.max(1, Math.min(parseInt(req.body?.max, 20) || 8, 10));

    if (!paragraph || typeof paragraph !== 'string' || paragraph.trim().length === 0) {
      return res.status(400).json({ error: 'paragraph is required' });
    }

    let prompts = [];
    const wrapPrompt = (description) => `Generate a high-quality, visually striking image of ${description}, with [STYLE/ATMOSPHERE], realistic details, vivid colors, cinematic lighting, modern and attractive aesthetic, professional composition.`;

    if (process.env.OPENROUTER_API_KEY) {
      const body = {
        model: "nousresearch/deephermes-3-llama-3-8b-preview:free",
        messages: [
          {
            role: "user",
            content: `You are given ONE paragraph. Generate visual image prompts that strictly reflect its content.
CRITICAL RULES:
- Produce up to ${maxVariants} DISTINCT prompts capturing different high-signal visual concepts.
- Preserve the narrative order of appearance from the paragraph when applicable.
- Prompts MUST be concise (~8–20 words), specific, and free of filler.
- Prefer hooks, key scenes, turning points, concrete subjects; avoid duplicates.
- Assume vertical 9:16 framing; mention subject, setting, mood/lighting when relevant.
Return STRICT JSON ONLY: { "prompts": ["...", "..."] } with 1-${maxVariants} items.

Paragraph:
${paragraph}`
          }
        ],
        max_tokens: 900,
        temperature: 0.3
      };

      try {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });

        if (resp.ok) {
          const data = await resp.json();
          // Claude on OpenRouter sometimes returns content as array of objects
          const content = data?.choices?.[0]?.message?.content;
          let raw = "";

          if (typeof content === "string") {
            raw = content;
          } else if (Array.isArray(content)) {
            raw = content.map(c => c?.text || "").join("\n");
          }

          try {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.prompts)) {
              prompts = parsed.prompts
                .map(s => String(s).trim())
                .filter(Boolean)
                .slice(0, maxVariants);
            }
          } catch (_) {
            console.warn("[VTR] Failed to parse Claude output as JSON:", raw);
          }
        } else {
          const err = await resp.json().catch(() => ({}));
          console.warn("[VTR] OpenRouter prompt API error:", resp.status, err);
        }
      } catch (e) {
        console.error("[VTR] Network error:", e.message);
      }
    }

    // fallback if Claude call fails
    if (!Array.isArray(prompts) || prompts.length === 0) {
      const base = String(paragraph).trim();
      prompts = [base];
    }

    // Apply high-quality template to each prompt
    prompts = prompts.map(p => wrapPrompt(p));

    return res.json({ prompts });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to generate image prompts",
      details: err.message
    });
  }
}

module.exports.generateImagePromptsForParagraph = generateImagePromptsForParagraph;

// Generate a reel by trimming the uploaded video according to important sentences matched to SRT
async function generateReel(req, res) {
  const uploadedFile = req.file;
  try {
    if (!uploadedFile || !uploadedFile.path) {
      return res.status(400).json({ error: 'Video file is required' });
    }
    // Validate input path exists (helps when invoked via async service mock)
    const fs = require('fs');
    if (!fs.existsSync(uploadedFile.path)) {
      return res.status(400).json({ error: `Input video not found at ${uploadedFile.path}` });
    }
    const srt = req.body?.srt;
    const wordSrt = req.body?.wordSrt; // optional word-level SRT (for text overlay)
    const fontKeyFromReq = (req.body?.fontKey || '').toString().toLowerCase();
    const allowedFonts = ['khand','notosans','poppins','amaticsc','bebasneue','comfortaa','exo2italic','orbitron','pacifico','shadowsintolight'];
    const selectedFontKey = allowedFonts.includes(fontKeyFromReq) ? fontKeyFromReq : 'notosans';
    const textColorFromReq = (req.body?.textColor || 'white').toString().toLowerCase();
    const selectedTextColor = ['white','black'].includes(textColorFromReq) ? textColorFromReq : 'white';
    
    const sentencesRaw = req.body?.sentences;
    // Optional image overlays
    let images = [];
    try {
      const imagesRaw = req.body?.images;
      const parsed = Array.isArray(imagesRaw) ? imagesRaw : JSON.parse(imagesRaw || '[]');
      if (Array.isArray(parsed)) images = parsed.filter(Boolean);
    } catch (_) {}
    if (!srt || !sentencesRaw) {
      return res.status(400).json({ error: 'Both srt and sentences are required' });
    }
    const sentences = Array.isArray(sentencesRaw)
      ? sentencesRaw
      : JSON.parse(sentencesRaw);

    const paddingSeconds = Number(req.body?.paddingSeconds ?? 0.3);

    // Build segments from SRT by matching sentences
    const entries = parseSRT(srt);
    const grouped = groupSRTIntoSentencesFromEntries(entries);
    const wordEntries = wordSrt ? parseSRT(wordSrt) : [];
    let segments = matchSentencesToSegments(sentences, grouped, paddingSeconds);
    console.log('[VTR] Matched segments before clamp:', segments);
    if (segments.length === 0) {
      // Fallback: use the first maxTotalSeconds from start to ensure a reel is produced
      console.warn('VTR: No matching segments found. Falling back to first seconds of the video.');
      segments = [{ start: 0, end: Math.max(1, Math.min(60, 60)) }];
    }

    // No overall duration clipping: keep all merged segments
    console.log('[VTR] Clipped segments:', segments);
    if (segments.length === 0) {
      return res.status(400).json({ error: 'Resulting segments empty after constraints' });
    }

    // Match word-level SRT entries to segments for text overlay
    const segmentOverlays = matchWordSrtToSegments(segments, wordEntries);
    console.log('[VTR] Segment overlays:', segmentOverlays.map((overlays, i) => `Segment ${i}: ${overlays.length} overlays`));

    const inputPath = uploadedFile.path;
    const workDir = path.join('temp', 'reels');
    fs.mkdirSync(workDir, { recursive: true });

    // 1) Build portrait base segments (trim/crop only) and compute durations
    const trimmedSegPaths = [];
    const segDurations = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const rawPath = path.join(workDir, `seg_raw_${Date.now()}_${i}.mp4`);
      await new Promise((resolve, reject) => {
        let command = ffmpeg(inputPath)
          .setStartTime(seg.start)
          .setDuration(Math.max(0.01, seg.end - seg.start))
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
          .addOption('-loglevel', 'error');

        const filterList = [
          'scale=1080:1920:force_original_aspect_ratio=increase',
          'crop=1080:1920:(iw-1080)/2:(ih-1920)/2'
        ];
        command = command.videoFilters(filterList);

        command
          .on('start', (cmd) => console.log(`[VTR] ffmpeg base segment ${i} trim start:`, cmd))
          .on('error', (e) => reject(e))
          .on('end', () => resolve())
          .save(rawPath);
      });
      trimmedSegPaths.push(rawPath);
      segDurations.push(Math.max(0.01, segments[i].end - segments[i].start));
    }

    // 2) Concat portrait base segments into a single base video
    const concatListPath = path.join(workDir, `list_${Date.now()}.txt`);
    const concatFileContent = trimmedSegPaths
      .filter(p => fs.existsSync(p))
      .map(p => {
        const abs = path.resolve(p).replace(/\\/g, '/');
        return `file '${abs.replace(/'/g, "'\\''")}'`;
      })
      .join('\n');
    if (!concatFileContent.trim()) {
      throw new Error('No valid segments to concatenate');
    }
    fs.writeFileSync(concatListPath, concatFileContent);
    const baseVideoPath = path.join(workDir, `base_${Date.now()}.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f concat', '-safe 0'])
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
        .on('start', (cmd) => console.log('[VTR] ffmpeg base concat start:', cmd))
        .on('error', (e) => reject(e))
        .on('end', resolve)
        .save(baseVideoPath);
    });

    // Compute cumulative offsets for each segment in the base timeline
    const segOffsets = [];
    let offset = 0;
    for (let i = 0; i < segDurations.length; i++) {
      const d = segDurations[i];
      segOffsets.push({ start: offset, end: offset + d });
      offset += d;
    }

    // 3) First pass: overlay images directly with fade transitions at 3s intervals
    let imageOverlayPath = baseVideoPath;
    let imgTempPaths = [];
    if (Array.isArray(images) && images.length > 0) {
      // Materialize images and add as inputs
      const imgInputPaths = [];
      for (let i = 0; i < images.length; i++) {
        const dataUrl = String(images[i]);
        const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
        if (!m) continue;
        const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
        const b64 = m[2];
        const p = path.join(workDir, `img_${Date.now()}_${i}.${ext}`);
        fs.writeFileSync(p, Buffer.from(b64, 'base64'));
        imgInputPaths.push(p);
        imgTempPaths.push(p);
      }

      if (imgInputPaths.length > 0) {
        // Probe duration
        const getDuration = () => new Promise((resolve) => {
          ffmpeg.ffprobe(baseVideoPath, (err, data) => {
            if (err) return resolve(0);
            const dur = Number(data?.format?.duration || 0);
            resolve(isFinite(dur) ? dur : 0);
          });
        });
        const baseDuration = await getDuration();

        const overlayFilters = [];
        let prevLabel = '[0:v]';
        const fadeDur = 0.3;
        for (let i = 0; i < imgInputPaths.length; i++) {
          const start = 3 + i * 3;
          if (start >= baseDuration) break;
          const end = Math.min(start + IMAGE_VIDEO_DURATION, baseDuration);
          const preLabel = `[sov_pre_${i + 1}]`;
          const fadedLabel = `[sovf_${i + 1}]`;
          const shiftedLabel = `[sov${i + 1}]`;
          const outLabel = i === imgInputPaths.length - 1 ? '[ivout]' : `[iv${i + 1}]`;
          // Build a timed overlay stream from a single image: scale -> loop to duration -> fade in/out -> shift to start time
          overlayFilters.push(`[${i + 1}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)/2:(ih-1920)/2,format=rgba,loop=loop=${Math.max(1, Math.floor(30*IMAGE_VIDEO_DURATION))}:size=1:start=0,setpts=N/30/TB${preLabel}`);
          overlayFilters.push(`${preLabel}fade=t=in:st=0:d=${fadeDur}:alpha=1,fade=t=out:st=${(IMAGE_VIDEO_DURATION - fadeDur).toFixed(3)}:d=${fadeDur}:alpha=1${fadedLabel}`);
          overlayFilters.push(`${fadedLabel}setpts=PTS+${start.toFixed(3)}/TB${shiftedLabel}`);
          overlayFilters.push(`${prevLabel}${shiftedLabel}overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'${outLabel}`);
          prevLabel = outLabel;
        }

        const imgVf = overlayFilters.join(';');
        const imgOut = path.join(workDir, `base_with_images_${Date.now()}.mp4`);
        await new Promise((resolve, reject) => {
          let cmd = ffmpeg().input(baseVideoPath);
          imgInputPaths.forEach(p => { cmd = cmd.input(p); });
          if (imgVf) cmd = cmd.complexFilter(imgVf);
          cmd
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
            .addOption('-map', prevLabel || '0:v')
            .addOption('-map', '0:a?')
            .addOption('-shortest')
            .on('start', (s) => console.log('[VTR] ffmpeg image overlay start:', s))
            .on('error', (e) => reject(e))
            .on('end', resolve)
            .save(imgOut);
        });
        imageOverlayPath = imgOut;
      }
    }

    // 4) Second pass: apply word-level text overlays on top of the image-overlayed video
    // Build combined drawtext filters across whole timeline using segment offsets
    const drawFilters = [];
    let lastLabel = '0:v';
    for (let i = 0; i < segments.length; i++) {
      const baseOffset = segOffsets[i];
      const overlays = segmentOverlays[i] || [];
      for (let j = 0; j < overlays.length; j++) {
        const o = overlays[j];
        const cleanText = cleanTextForDrawtext(o.text);
        if (!cleanText.trim()) continue;
        const position = (j % 2 === 0) ? 'top' : 'bottom';
    const bgFromReq = (req.body?.backgroundColor || '').toString().toLowerCase();
    const selectedBgColor = ['white','black'].includes(bgFromReq) ? bgFromReq : undefined;
    const drawtextFilter = buildDrawtextFilter(cleanText, selectedFontKey, position, selectedTextColor, selectedBgColor);
        const outLabel = (i === segments.length - 1 && j === overlays.length - 1) ? 'vout' : `v_${i}_${j}`;
        const startT = Math.max(0, baseOffset.start + o.startTime);
        const endT = Math.max(0, baseOffset.start + o.endTime);
        const filter = `[${lastLabel}]${drawtextFilter}:enable='between(t,${startT.toFixed(3)},${endT.toFixed(3)})'[${outLabel}]`;
        drawFilters.push(filter);
        lastLabel = outLabel;
      }
    }

    let finalPath = path.join(workDir, `reel_${Date.now()}.mp4`);
    if (drawFilters.length > 0) {
      const complexFilter = drawFilters.join(';');
      await new Promise((resolve, reject) => {
        let cmd = ffmpeg().input(imageOverlayPath);
        cmd = cmd.complexFilter(complexFilter).outputOptions(['-map', '[vout]', '-map', '0:a?']);
        cmd
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
          .on('start', (s) => console.log('[VTR] ffmpeg text overlay start:', s))
          .on('error', (e) => reject(e))
          .on('end', resolve)
          .save(finalPath);
      });
    } else {
      // No text overlays; just copy imageOverlayPath to finalPath
      try { fs.copyFileSync(imageOverlayPath, finalPath); } catch(_) {}
    }

    // 5) Optional outro concatenation
    try {
      const outroPath = path.join(__dirname, '..', 'assets', 'outrow video.mp4');
      if (fs.existsSync(outroPath)) {
        const normalizedFinal = path.join(workDir, `reel_norm_${Date.now()}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg(finalPath)
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
            .on('error', (e) => reject(e))
            .on('end', resolve)
            .save(normalizedFinal);
        });
        const normalizedOutro = path.join(workDir, `outro_norm_${Date.now()}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg(outroPath)
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
            .on('error', (e) => reject(e))
            .on('end', resolve)
            .save(normalizedOutro);
        });
        const listPath = path.join(workDir, `concat_${Date.now()}.txt`);
        const listContent = [normalizedFinal, normalizedOutro]
          .map(p => `file '${path.resolve(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(listPath, listContent);
        const concatenated = path.join(workDir, `reel_with_outro_${Date.now()}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(listPath)
            .inputOptions(['-f concat', '-safe 0'])
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart', '-preset veryfast', '-crf 23'])
            .on('error', (e) => reject(e))
            .on('end', resolve)
            .save(concatenated);
        });
        finalPath = concatenated;
        try { safeCleanup([normalizedFinal, normalizedOutro, listPath]); } catch(_) {}
      }
    } catch (e) {
      console.warn('[VTR] Outro concat failed (generateReel path):', e?.message || e);
    }

    // 5) Stream result and cleanup
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="reel.mp4"');
    const stream = fs.createReadStream(finalPath);
    stream.on('close', () => {
      try { safeCleanup([uploadedFile.path]); } catch(_) {}
      try { safeCleanup(trimmedSegPaths); } catch(_) {}
      try { safeCleanup([concatListPath, baseVideoPath]); } catch(_) {}
      try { safeCleanup(overlaySegPaths.filter(Boolean)); } catch(_) {}
      try { safeCleanup(imgTempPaths); } catch(_) {}
      try {
        if (imageOverlayPath && imageOverlayPath !== baseVideoPath && imageOverlayPath !== finalPath) {
          safeCleanup([imageOverlayPath]);
        }
      } catch(_) {}
      try {
        const files = fs.readdirSync(workDir).filter(f => f.startsWith('list_') && f.endsWith('.txt'));
        safeCleanup(files.map(f => path.join(workDir, f)));
      } catch(_) {}
      // Final sweep: remove common leftover files in temp/reels
      try {
        const leftovers = fs.readdirSync(workDir)
          .filter(f => /^(seg_raw_|seg_|ov_|base_|reel_|overlay_|reel_norm_|outro_norm_|base_with_images_|img_|list_|concat_)/.test(f))
          .map(f => path.join(workDir, f));
        if (leftovers.length) safeCleanup(leftovers);
        // Remove directory if empty
        try {
          const remaining = fs.readdirSync(workDir);
          if (remaining.length === 0) {
            fs.rmdirSync(workDir);
          }
        } catch(_) {}
      } catch(_) {}
    });
    stream.pipe(res);
  } catch (err) {
    // Cleanup temp files
    const maybePaths = [req?.file?.path];
    try { safeCleanup(maybePaths); } catch (_) {}
    console.error('[VTR] generateReel failed:', err?.message || err, err?.stack);
    return res.status(500).json({ error: 'Failed to generate reel', details: err?.message || String(err) });
  }
}

// Helper: generate individual reel segment files (no concat). Returns up to maxCount paths.
async function generateReelSegments({ inputPath, srt, wordSrt, sentences, paragraphIndices, paddingSeconds = 0.3, portrait = false, maxCount = 3, textColor = 'white', fontKey = 'notosans', backgroundColor = undefined }) {
  const entries = parseSRT(srt);
  const grouped = groupSRTIntoSentencesFromEntries(entries);
  const wordEntries = wordSrt ? parseSRT(wordSrt) : [];
  // If paragraphIndices provided, build segments directly from index spans per paragraph
  let segments;
  if (Array.isArray(paragraphIndices) && paragraphIndices.length > 0) {
    const clamped = paragraphIndices
      .map(arr => Array.isArray(arr) ? arr.map(i => Math.max(0, Math.min(grouped.length - 1, i))) : [])
      .filter(a => a.length > 0);
    segments = clamped.map(idxs => {
      const minI = Math.min(...idxs);
      const maxI = Math.max(...idxs);
      const start = Math.max(0, (grouped[minI]?.startTime ?? 0) - Number(paddingSeconds || 0.3));
      const end = (grouped[maxI]?.endTime ?? 0) + Number(paddingSeconds || 0.3);
      return { start, end };
    });
  } else {
    segments = matchSentencesToSegments(sentences, grouped, Number(paddingSeconds || 0.3));
  }
  if (!Array.isArray(segments) || segments.length === 0) return [];

  // Match word-level SRT entries to segments for text overlay
  const segmentOverlays = matchWordSrtToSegments(segments, wordEntries);

  const workDir = path.join('temp', 'reels');
  fs.mkdirSync(workDir, { recursive: true });
  const outPaths = [];

  const limit = Math.max(1, Math.min(maxCount, segments.length));
  for (let i = 0; i < limit; i++) {
    const seg = segments[i];
    const rawPath = path.join(workDir, `seg_raw_${Date.now()}_${i}.mp4`);
    const outPath = path.join(workDir, `seg_${Date.now()}_${i}.mp4`);
    const overlays = segmentOverlays[i] || [];

    // Pass 1: trim/crop to portrait format
    await new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath)
        .setStartTime(seg.start)
        .setDuration(Math.max(0.01, seg.end - seg.start))
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
        .addOption('-loglevel', 'error');
      const filterList = [
        'scale=1080:1920:force_original_aspect_ratio=increase',
        'crop=1080:1920:(iw-1080)/2:(ih-1920)/2'
      ];
      command = command.videoFilters(filterList);
      command
        .on('start', (cmd) => console.log(`[VTR] ffmpeg segment-only ${i} trim start:`, cmd))
        .on('error', (e) => reject(e))
        .on('end', () => resolve())
        .save(rawPath);
    });

    // Pass 2: Add text overlay if we have word-level SRT entries
    if (overlays.length > 0) {
      const MAX_SEGMENT_OVERLAYS = 25; // avoid ENAMETOOLONG on Windows
      let selected = overlays;
      if (overlays.length > MAX_SEGMENT_OVERLAYS) {
        const step = Math.max(1, Math.ceil(overlays.length / MAX_SEGMENT_OVERLAYS));
        selected = overlays.filter((_, idx) => idx % step === 0).slice(0, MAX_SEGMENT_OVERLAYS);
      }
      console.log(`[VTR] Adding ${selected.length}/${overlays.length} text overlays to segment ${i}`);
      
      // Build drawtext filters for this segment
      const drawFilters = [];
      let lastLabel = '0:v';
      
      for (let j = 0; j < selected.length; j++) {
        const overlay = selected[j];
        const cleanText = cleanTextForDrawtext(overlay.text);
        
        if (!cleanText.trim()) continue;
        
        // Alternate position: top for even indices, bottom for odd
        const position = (j % 2 === 0) ? 'top' : 'bottom';
        const drawtextFilter = buildDrawtextFilter(cleanText, fontKey, position, textColor, backgroundColor);
        
        const outLabel = j === selected.length - 1 ? 'vout' : `v${j}`;
        const filter = `[${lastLabel}]${drawtextFilter}:enable='between(t,${overlay.startTime.toFixed(3)},${overlay.endTime.toFixed(3)})'[${outLabel}]`;
        drawFilters.push(filter);
        lastLabel = outLabel;
      }
      
      if (drawFilters.length > 0) {
        const complexFilter = drawFilters.join(';');
        
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(rawPath)
            .complexFilter(complexFilter)
            .outputOptions([
              '-map', '[vout]',
              '-map', '0:a',
              '-c:v', 'libx264',
              '-c:a', 'copy',
              '-preset', 'veryfast',
              '-crf', '23',
              '-y'
            ])
            .on('start', (cmd) => console.log(`[VTR] ffmpeg segment-only ${i} overlay start:`, cmd))
            .on('error', (e) => reject(e))
            .on('end', () => resolve())
            .save(outPath);
        });
      } else {
        // No valid overlays, just copy the raw segment
        try { fs.copyFileSync(rawPath, outPath); } catch(_) {}
      }
    } else {
      // No overlays, just copy the raw segment
      try { fs.copyFileSync(rawPath, outPath); } catch(_) {}
    }
    
    // Clean up raw segment
    try { fs.unlinkSync(rawPath); } catch(_) {}
    outPaths.push(outPath);
  }
  return outPaths;
}

module.exports.generateReelSegments = generateReelSegments;

function matchSentencesToSegments(importantSentences, sentenceEntries, paddingSeconds) {
  const segments = [];
  for (const imp of importantSentences) {
    const normImp = normalizeText(imp);
    // Collect all transcript sentences that overlap with this paragraph text
    const matches = [];
    for (let i = 0; i < sentenceEntries.length; i++) {
      const s = sentenceEntries[i];
      const normText = normalizeText(s.text || '');
      if (!normText) continue;
      const contains = normImp.includes(normText) || normText.includes(normImp);
      const score = contains ? 1 : jaccardSimilarity(normImp, normText);
      if (contains || score > 0.18) {
        matches.push({ idx: i, start: s.startTime, end: s.endTime });
      }
    }
    if (matches.length === 0) {
      // Fallback: pick best single sentence as before
      let bestIdx = -1;
      let bestScore = 0;
      for (let i = 0; i < sentenceEntries.length; i++) {
        const s = sentenceEntries[i];
        const normText = normalizeText(s.text || '');
        const contains = normText.includes(normImp) || normImp.includes(normText);
        const score = contains ? 1 : jaccardSimilarity(normImp, normText);
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      if (bestIdx >= 0 && bestScore > 0.08) {
        const se = sentenceEntries[bestIdx];
        const start = Math.max(0, se.startTime - paddingSeconds);
        const end = se.endTime + paddingSeconds;
        segments.push({ start, end });
      }
      continue;
    }
    // Expand to contiguous span covering all matched sentences
    const minStart = Math.min(...matches.map(m => m.start));
    const maxEnd = Math.max(...matches.map(m => m.end));
    const start = Math.max(0, minStart - paddingSeconds);
    const end = maxEnd + paddingSeconds;
    segments.push({ start, end });
  }
  // Merge overlapping segments but preserve order
  segments.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const seg of segments) {
    if (merged.length === 0 || seg.start > merged[merged.length - 1].end) {
      merged.push({ ...seg });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, seg.end);
    }
  }
  return merged;
}

// Helper function to match word-level SRT entries to segments for text overlay
function matchWordSrtToSegments(segments, wordEntries) {
  const segmentOverlays = [];
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const overlays = [];
    
    // Find word-level entries that fall within this segment
    for (const wordEntry of wordEntries) {
      if (wordEntry.startTime >= segment.start && wordEntry.endTime <= segment.end) {
        // Adjust timing relative to segment start
        overlays.push({
          startTime: wordEntry.startTime - segment.start,
          endTime: wordEntry.endTime - segment.start,
          text: wordEntry.text || ''
        });
      }
    }
    
    segmentOverlays.push(overlays);
  }
  
  return segmentOverlays;
}

function normalizeText(t) {
  return String(t)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardSimilarity(a, b) {
  const setA = new Set(a.split(' ').filter(Boolean));
  const setB = new Set(b.split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  return inter / (setA.size + setB.size - inter);
}

module.exports.generateReel = generateReel;

// Generate a mini reel: trim to the first important sentence and overlay images at 5s gaps
// removed mini-reel generation (migrated to overlayImagesOnVideo flow)
async function generateMiniReelWithImages(req, res) {
  try {
    const uploadedFile = req.file;
    const srt = req.body?.srt;
    const imagesJson = req.body?.images;
    if (!uploadedFile || !uploadedFile.path) {
      return res.status(400).json({ error: 'Video file is required' });
    }
    if (!srt || typeof srt !== 'string' || srt.trim().length === 0) {
      return res.status(400).json({ error: 'Sentence-level SRT is required' });
    }
    let images = [];
    try {
      const parsed = JSON.parse(imagesJson || '[]');
      if (Array.isArray(parsed)) images = parsed.filter(Boolean);
    } catch (_) {}
    if (images.length === 0) {
      return res.status(400).json({ error: 'At least one image (data URL) is required' });
    }

    const workDir = path.join('temp', 'reels');
    fs.mkdirSync(workDir, { recursive: true });

    // 1) Find first sentence segment from SRT
    const entries = parseSRT(srt);
    const grouped = groupSRTIntoSentencesFromEntries(entries);
    if (!Array.isArray(grouped) || grouped.length === 0) {
      return res.status(400).json({ error: 'No sentences found in SRT' });
    }
    const first = grouped[0];
    const startTime = Math.max(0, first.startTime);
    const duration = Math.max(0.01, first.endTime - first.startTime);

    // 2) Trim the main video to this segment (and portrait 9:16)
    const segPath = path.join(workDir, `mini_seg_${Date.now()}.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg(uploadedFile.path)
        .setStartTime(startTime)
        .setDuration(duration)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
        .videoFilters([
          'scale=1080:1920:force_original_aspect_ratio=increase',
          'crop=1080:1920:(iw-1080)/2:(ih-1920)/2'
        ])
        .addOption('-loglevel', 'error')
        .on('error', reject)
        .on('end', resolve)
        .save(segPath);
    });

    // 3) Build overlay filter at 3s intervals, centered
    // Enable windows: [3,5], [6,8], ... within the trimmed segment (2-second image videos)
    const overlayFilters = [];
    // base: start from input0 video, already 1080x1920 due to trim filter above
    let prevLabel = '[0:v]';
    // Materialize images as inputs
    const imgPaths = [];
    for (let i = 0; i < images.length; i++) {
      const dataUrl = String(images[i]);
      const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
      if (!m) continue;
      const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
      const b64 = m[2];
      const p = path.join(workDir, `overlay_${Date.now()}_${i}.${ext}`);
      fs.writeFileSync(p, Buffer.from(b64, 'base64'));
      imgPaths.push(p);
    }
    if (imgPaths.length === 0) {
      try { safeCleanup([segPath, uploadedFile.path]); } catch(_) {}
      return res.status(400).json({ error: 'No valid image data provided' });
    }
    for (let i = 0; i < imgPaths.length; i++) {
      const start = 3 + i * 3;
      const end = start + IMAGE_VIDEO_DURATION;
      if (start >= duration) break;
      const clampedEnd = Math.min(end, duration);
      const preLabel = `[si_pre_${i + 1}]`;
      const fadedLabel = `[sif_${i + 1}]`;
      const shiftedLabel = `[si${i + 1}]`;
      const outLabel = `[v${i + 1}]`;
      overlayFilters.push(`[${i + 1}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)/2:(ih-1920)/2,format=rgba,loop=loop=${Math.max(1, Math.floor(30*IMAGE_VIDEO_DURATION))}:size=1:start=0,setpts=N/30/TB${preLabel}`);
      overlayFilters.push(`${preLabel}fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=${(IMAGE_VIDEO_DURATION - 0.3).toFixed(3)}:d=0.3:alpha=1${fadedLabel}`);
      overlayFilters.push(`${fadedLabel}setpts=PTS+${start.toFixed(3)}/TB${shiftedLabel}`);
      overlayFilters.push(`${prevLabel}${shiftedLabel}overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:enable='between(t,${start.toFixed(3)},${clampedEnd.toFixed(3)})'${outLabel}`);
      prevLabel = outLabel;
    }
    const lastLabel = prevLabel;
    const vf = overlayFilters.length > 0 ? overlayFilters.join(';') : null;

    const outPath = path.join(workDir, `mini_reel_${Date.now()}.mp4`);
    await new Promise((resolve, reject) => {
      let cmd = ffmpeg();
      cmd = cmd.input(segPath);
      for (let i = 0; i < imgPaths.length; i++) cmd = cmd.input(imgPaths[i]);
      const videoLabel = lastLabel; // like [vN] or [0:v]
      if (vf) cmd = cmd.complexFilter(vf);
      cmd
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
        // Preserve audio from first input (trimmed segment) and map filtered video
        .addOption('-map', videoLabel)
        .addOption('-map', '0:a?')
        .addOption('-shortest')
        .on('error', (e) => reject(e))
        .on('end', resolve)
        .save(outPath);
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="mini_reel.mp4"');
    const stream = fs.createReadStream(outPath);
    stream.on('close', () => {
      try { safeCleanup([segPath, outPath, uploadedFile.path, ...imgPaths]); } catch(_) {}
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[VTR] generateMiniReelWithImages failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to generate mini reel', details: err?.message || String(err) });
  }
}

// Overlay images at 5s intervals over an existing video (by URL)
async function overlayImagesOnVideo(req, res) {
  try {
    const videoUrl = req.body?.videoUrl;
    const images = Array.isArray(req.body?.images) ? req.body.images.filter(Boolean) : [];
    if (!videoUrl || typeof videoUrl !== 'string') {
      return res.status(400).json({ error: 'videoUrl is required' });
    }
    if (images.length === 0) {
      return res.status(400).json({ error: 'At least one image (data URL) is required' });
    }

    const workDir = path.join('temp', 'reels');
    fs.mkdirSync(workDir, { recursive: true });

    // 1) Download source video to temp
    const srcPath = path.join(workDir, `src_${Date.now()}.mp4`);
    const resp = await fetch(videoUrl);
    if (!resp.ok) return res.status(400).json({ error: `Failed to download video (${resp.status})` });
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(srcPath, buf);

    // 2) Probe duration
    const getDuration = () => new Promise((resolve) => {
      ffmpeg.ffprobe(srcPath, (err, data) => {
        if (err) return resolve(0);
        const dur = Number(data?.format?.duration || 0);
        resolve(isFinite(dur) ? dur : 0);
      });
    });
    const duration = await getDuration();

    // 3) Build overlay filter chain at 3s intervals; ensure base video portrait
    const overlayFilters = [];
    // Add a base scale/crop to 1080x1920 to be safe if source isn't portrait
    overlayFilters.push('[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)/2:(ih-1920)/2[base]');
    let prevLabel = '[base]';
    // Materialize images
    const imgPaths = [];
    for (let i = 0; i < images.length; i++) {
      const dataUrl = String(images[i]);
      const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
      if (!m) continue;
      const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
      const b64 = m[2];
      const p = path.join(workDir, `ov_${Date.now()}_${i}.${ext}`);
      fs.writeFileSync(p, Buffer.from(b64, 'base64'));
      imgPaths.push(p);
    }
    if (imgPaths.length === 0) {
      try { safeCleanup([srcPath]); } catch(_) {}
      return res.status(400).json({ error: 'No valid image data provided' });
    }
    for (let i = 0; i < imgPaths.length; i++) {
      const start = 3 + i * 3;
      if (duration && start >= duration) break;
      const end = Math.min(start + IMAGE_VIDEO_DURATION, duration || (start + IMAGE_VIDEO_DURATION));
      const preLabel = `[sov_pre_${i + 1}]`;
      const fadedLabel = `[sovf_${i + 1}]`;
      const shiftedLabel = `[sov${i + 1}]`;
      const outLabel = `[ov${i + 1}]`;
      overlayFilters.push(`[${i + 1}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)/2:(ih-1920)/2,format=rgba,loop=loop=${Math.max(1, Math.floor(30*IMAGE_VIDEO_DURATION))}:size=1:start=0,setpts=N/30/TB${preLabel}`);
      overlayFilters.push(`${preLabel}fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=${(IMAGE_VIDEO_DURATION - 0.3).toFixed(3)}:d=0.3:alpha=1${fadedLabel}`);
      overlayFilters.push(`${fadedLabel}setpts=PTS+${start.toFixed(3)}/TB${shiftedLabel}`);
      overlayFilters.push(`${prevLabel}${shiftedLabel}overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'${outLabel}`);
      prevLabel = outLabel;
    }
    const vf = overlayFilters.join(';');

    const outPath = path.join(workDir, `overlay_${Date.now()}.mp4`);
    await new Promise((resolve, reject) => {
      let cmd = ffmpeg();
      cmd = cmd.input(srcPath);
      for (let i = 0; i < imgPaths.length; i++) cmd = cmd.input(imgPaths[i]);
      if (vf) cmd = cmd.complexFilter(vf);
      cmd
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
        .addOption('-map', prevLabel)
        .addOption('-map', '0:a?')
        .addOption('-shortest')
        .on('error', (e) => reject(e))
        .on('end', resolve)
        .save(outPath);
    });

    // If an outro video exists in assets, append it to the end
    let finalVideoPath = outPath;
    try {
      const outroPath = path.join(__dirname, '..', 'assets', 'outrow video.mp4');
      if (fs.existsSync(outroPath)) {
        // First, normalize BOTH outputs to match exactly (resolution, fps, pixel format, audio)
        const normalizedOverlay = path.join(workDir, `overlay_norm_${Date.now()}.mp4`);
        const normalizedOutro = path.join(workDir, `outro_norm_${Date.now()}.mp4`);

        // Normalize overlay result
        await new Promise((resolve, reject) => {
          ffmpeg(outPath)
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
            .on('error', (e) => reject(e))
            .on('end', resolve)
            .save(normalizedOverlay);
        });

        // Normalize outro
        await new Promise((resolve, reject) => {
          ffmpeg(outroPath)
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
            .on('error', (e) => reject(e))
            .on('end', resolve)
            .save(normalizedOutro);
        });

        // Concat the normalized overlay and normalized outro using concat demuxer
        const listPath = path.join(workDir, `concat_${Date.now()}.txt`);
        const listContent = [normalizedOverlay, normalizedOutro]
          .map(p => `file '${path.resolve(p).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
          .join('\n');
        fs.writeFileSync(listPath, listContent);

        const concatenatedPath = path.join(workDir, `overlay_with_outro_${Date.now()}.mp4`);
        await new Promise((resolve, reject) => {
          ffmpeg()
            .input(listPath)
            .inputOptions(['-f concat', '-safe 0'])
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions(['-pix_fmt yuv420p', '-movflags +faststart', '-preset veryfast', '-crf 23'])
            .on('error', (e) => reject(e))
            .on('end', resolve)
            .save(concatenatedPath);
        });
        finalVideoPath = concatenatedPath;
        try { safeCleanup([normalizedOverlay, normalizedOutro, listPath]); } catch(_) {}
      }
    } catch (e) {
      console.warn('[VTR] Outro concat failed, returning overlay only:', e?.message || e);
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="overlay.mp4"');
    const stream = fs.createReadStream(finalVideoPath);
    stream.on('close', () => {
      try {
        const cleanupList = [srcPath, outPath, ...imgPaths];
        if (finalVideoPath && finalVideoPath !== outPath) cleanupList.push(finalVideoPath);
        safeCleanup(cleanupList);
      } catch(_) {}
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[VTR] overlayImagesOnVideo failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to overlay images', details: err?.message || String(err) });
  }
}

module.exports.overlayImagesOnVideo = overlayImagesOnVideo;


