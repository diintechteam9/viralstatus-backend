const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeStatic = require("ffprobe-static");
const { createClient } = require("@deepgram/sdk");
const fetch = require("node-fetch");

// Bundled font support (use NotoSans-Regular.ttf from assets/fonts)
const FONT_DIR = path.join(__dirname, "../assets/fonts");
const resolveFontPath = () => {
  const candidate = path.join(FONT_DIR, 'NotoSans-Regular.ttf');
  return fs.existsSync(candidate) ? candidate : null;
};

try {
  if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  }
  if (ffprobeStatic && ffprobeStatic.path) {
    ffmpeg.setFfprobePath(ffprobeStatic.path);
  }
} catch (_) {}

// Extract audio from an uploaded video and stream back as MP3
async function extractAudio(req, res) {
  const uploadedFile = req.file;
  if (!uploadedFile) {
    return res.status(400).json({ message: "No video file uploaded" });
  }

  const inputPath = uploadedFile.path; // temp upload path from multer
  const outputFileName = `${path.parse(uploadedFile.originalname).name}-${Date.now()}.mp3`;
  const outputPath = path.join("temp", outputFileName);

  // Ensure temp directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  try {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("192k")
      .on("error", (err) => {
        safeCleanup([inputPath, outputPath]);
        return res.status(500).json({ message: "Audio extraction failed", error: err.message });
      })
      .on("end", () => {
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Disposition", `inline; filename="${outputFileName}"`);

        const stream = fs.createReadStream(outputPath);
        stream.on("close", () => safeCleanup([inputPath, outputPath]));
        stream.pipe(res);
      })
      .save(outputPath);
  } catch (error) {
    safeCleanup([inputPath, outputPath]);
    return res.status(500).json({ message: "Unexpected error", error: error.message });
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

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="captions.srt"');
    res.send(srtContent);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
}

function convertToSRT(result) {
  try {
    let allWords = [];
    if (
      result.results &&
      result.results.channels &&
      result.results.channels[0] &&
      result.results.channels[0].alternatives
    ) {
      const alternative = result.results.channels[0].alternatives[0];
      if (alternative && alternative.words && alternative.words.length > 0) {
        allWords = alternative.words;
      }
    }
    if (allWords.length === 0) return "";

    const sentences = groupWordsIntoSentences(allWords);
    let srt = "";
    let idx = 1;
    for (const sentence of sentences) {
      if (sentence.words.length === 0) continue;
      const start = sentence.words[0].start;
      const end = sentence.words[sentence.words.length - 1].end;
      const text = sentence.text.trim();
      if (!text) continue;
      srt += `${idx}\n`;
      srt += `${formatTime(start)} --> ${formatTime(end)}\n`;
      srt += `${text}\n\n`;
      idx++;
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
      // Optionally set language like 'hi' if needed
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

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="captions_words.srt"');
    res.send(srtContent);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
}

function convertToWordSRT(result) {
  try {
    let allWords = [];
    if (
      result.results &&
      result.results.channels &&
      result.results.channels[0] &&
      result.results.channels[0].alternatives
    ) {
      const alternative = result.results.channels[0].alternatives[0];
      if (alternative && alternative.words && alternative.words.length > 0) {
        allWords = alternative.words;
      }
    }
    if (allWords.length === 0) return "";

    let srtContent = "";
    let captionIndex = 1;
    const wordsPerCaption = 3; // chunk size

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

// Generate important sentences (ordered) from SRT via OpenRouter
async function generateImportantSentences(req, res) {
  try {
    const { srt, count } = req.body || {};
    if (!srt || typeof srt !== 'string' || srt.trim().length === 0) {
      return res.status(400).json({ error: "SRT content is required" });
    }

    const targetCount = Math.min(Math.max(parseInt(count || 3, 10) || 3, 1), 10);

    // Parse and group SRT to sentences
    const entries = parseSRT(srt);
    const grouped = groupSRTIntoSentencesFromEntries(entries);
    const sentences = grouped.map(g => (g.text || '').trim()).filter(Boolean);
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
            `Pick the ${targetCount} most important, high-signal sentences that would make engaging short reels.\n` +
            `CRITICAL RULES:\n` +
            `- Preserve the original order of appearance.\n` +
            `- Prefer hooks, key insights, turning points, or clear self-contained bits.\n` +
            `- Avoid near-duplicates and overly short fragments.\n` +
            `Return STRICT JSON: { "sentences": ["...", "...", "..."] } with exactly ${targetCount} items if possible.\n\n` +
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

    // Fallback: simple heuristic pick by length/containment, keep order
    if (!Array.isArray(important) || important.length === 0) {
      const scored = sentences.map((text, idx) => ({ idx, text, score: text.split(/\s+/).length }));
      scored.sort((a, b) => b.score - a.score);
      important = scored.slice(0, targetCount).sort((a, b) => a.idx - b.idx).map(s => s.text);
    }

    return res.json({ sentences: important });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate important sentences', details: err.message });
  }
}

function parseSRT(srtContent) {
  const entries = [];
  const normalized = String(srtContent).replace(/\r\n/g, '\n');
  const blocks = normalized.trim().split('\n\n');
  blocks.forEach(block => {
    const lines = block.split('\n');
    if (lines.length >= 2) {
      const timeLine = lines[1];
      const text = lines.slice(2).join(' ').trim();
      const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
      if (timeMatch) {
        const startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
        const endTime = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
        entries.push({ startTime, endTime, text });
      }
    }
  });
  return entries;
}

function groupSRTIntoSentencesFromEntries(entries) {
  const sentences = [];
  let current = null;
  entries.forEach((entry, idx) => {
    const text = (entry.text || '').trim();
    const endsSentence = /[.!?]$/.test(text);
    if (!current) {
      current = { startTime: entry.startTime, endTime: entry.endTime, text: text };
    } else {
      current.endTime = entry.endTime;
      if (text.length > 0) current.text += (current.text ? ' ' : '') + text;
    }
    if (endsSentence || idx === entries.length - 1) {
      const minWords = 4;
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
    const wordSrt = req.body?.wordSrt; // optional word-level SRT
    const sentencesRaw = req.body?.sentences;
    if (!srt || !sentencesRaw) {
      return res.status(400).json({ error: 'Both srt and sentences are required' });
    }
    const sentences = Array.isArray(sentencesRaw)
      ? sentencesRaw
      : JSON.parse(sentencesRaw);

    const paddingSeconds = Number(req.body?.paddingSeconds ?? 0.3);
    const maxTotalSeconds = Number(req.body?.maxTotalSeconds ?? 60);
    const portrait = String(req.body?.portrait ?? 'false') === 'true';

    // Build segments from SRT by matching sentences
    const entries = parseSRT(srt);
    const grouped = groupSRTIntoSentencesFromEntries(entries);
    const wordEntries = wordSrt ? parseSRT(wordSrt) : [];
    let segments = matchSentencesToSegments(sentences, grouped, paddingSeconds);
    console.log('[VTR] Matched segments before clamp:', segments);
    if (segments.length === 0) {
      // Fallback: use the first maxTotalSeconds from start to ensure a reel is produced
      console.warn('VTR: No matching segments found. Falling back to first seconds of the video.');
      segments = [{ start: 0, end: Math.max(1, Math.min(maxTotalSeconds, 60)) }];
    }

    // Clip to max total duration
    let total = 0;
    const clipped = [];
    for (const seg of segments) {
      const dur = Math.max(0, seg.end - seg.start);
      if (dur <= 0) continue;
      if (total + dur > maxTotalSeconds) {
        const remaining = Math.max(0, maxTotalSeconds - total);
        if (remaining > 0.5) {
          clipped.push({ start: seg.start, end: seg.start + remaining });
          total += remaining;
        }
        break;
      } else {
        clipped.push(seg);
        total += dur;
      }
    }
    console.log('[VTR] Clipped segments:', clipped);
    if (clipped.length === 0) {
      return res.status(400).json({ error: 'Resulting segments empty after constraints' });
    }

    const inputPath = uploadedFile.path;
    const workDir = path.join('temp', 'reels');
    fs.mkdirSync(workDir, { recursive: true });
    const segmentPaths = [];

    // Helper: clean text for ffmpeg drawtext
    const cleanTextForDrawtext = (text) => {
      return String(text || '')
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
        .replace(/%/g, ' percent ')
        .replace(/=/g, ' equals ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const buildDrawtextFilter = (text, position = 'bottom', enableExpr = null, fontSize = 36) => {
      const yExpr = position === 'top' ? `120` : `h-(line_h+40)`;
      const safeText = cleanTextForDrawtext(text);
      if (!safeText) return null;
      const base = `text='${safeText}':fontcolor=white:fontsize=${fontSize}:borderw=2:x=(w-text_w)/2:y=${yExpr}`;
      const fontPath = resolveFontPath();
      const prefix = fontPath
        ? `drawtext=fontfile='${fontPath.replace(/\\/g, '/') }':${base}`
        : `drawtext=${base}`;
      return enableExpr ? `${prefix}:enable='${enableExpr}'` : prefix;
    };

    // Export each segment (with optional overlay text from word-level SRT)
    for (let i = 0; i < clipped.length; i++) {
      const seg = clipped[i];
      const outPath = path.join(workDir, `seg_${Date.now()}_${i}.mp4`);
      await new Promise((resolve, reject) => {
        let command = ffmpeg(inputPath)
          .setStartTime(seg.start)
          .setDuration(Math.max(0.01, seg.end - seg.start))
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23']);

        // Collect filters to avoid overriding in multiple videoFilters calls
        const filterList = [];
        if (portrait) {
          // Auto center crop to 9:16 from original height
          // scale to height 1920 keeping aspect, then center crop width 1080
          filterList.push('scale=-2:1920');
          filterList.push('crop=1080:1920:(iw-1080)/2:0');
        }

        // Build timed overlay from word-level SRT within this segment (3 words per caption)
        const position = 'bottom';
        if (Array.isArray(wordEntries) && wordEntries.length > 0) {
          for (const we of wordEntries) {
            const st = Number(we.startTime);
            const en = Number(we.endTime);
            if (!isFinite(st) || !isFinite(en)) continue;
            if (st >= seg.end || en <= seg.start) continue; // no overlap
            const relStart = Math.max(0, st - seg.start);
            const relEnd = Math.max(relStart + 0.05, Math.min(en - seg.start, seg.end - seg.start));
            const t = String(we.text || '').trim();
            if (!t) continue;
            const enable = `between(t,${relStart.toFixed(2)},${relEnd.toFixed(2)})`;
            const dt = buildDrawtextFilter(t, position, enable, 32);
            if (dt) filterList.push(dt);
          }
        } else {
          // Fallback to a single sentence overlay (smaller font)
          const dt = buildDrawtextFilter(sentences[i] || '', 'bottom', null, 32);
          if (dt) filterList.push(dt);
        }
        if (filterList.length > 0) {
          command = command.videoFilters(filterList);
        }

        command
          .on('start', (cmd) => console.log(`[VTR] ffmpeg segment ${i} start:`, cmd))
          .on('stderr', (line) => console.log(`[VTR] ffmpeg segment ${i} stderr:`, line))
          .on('error', (e) => {
            console.error(`[VTR] ffmpeg segment ${i} error:`, e?.message || e);
            reject(e);
          })
          .on('end', () => {
            console.log(`[VTR] ffmpeg segment ${i} done ->`, outPath);
            resolve();
          })
          .save(outPath);
      });
      segmentPaths.push(outPath);
    }

    // If only one segment, return it directly to avoid concat issues
    let finalPath;
    if (segmentPaths.length === 1 && fs.existsSync(segmentPaths[0])) {
      finalPath = segmentPaths[0];
      console.log('[VTR] Single segment optimization, returning', finalPath);
    } else {
      // Concat segments with re-encode to ensure compatibility
      const concatListPath = path.join(workDir, `list_${Date.now()}.txt`);
      const concatFileContent = segmentPaths
        .filter(p => fs.existsSync(p))
        .map(p => {
          // Normalize Windows paths for ffmpeg concat demuxer
          const abs = path.resolve(p).replace(/\\/g, '/');
          return `file '${abs.replace(/'/g, "'\\''")}'`;
        })
        .join('\n');
      if (!concatFileContent.trim()) {
        throw new Error('No valid segments to concatenate');
      }
      fs.writeFileSync(concatListPath, concatFileContent);
      finalPath = path.join(workDir, `reel_${Date.now()}.mp4`);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(['-f concat', '-safe 0'])
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions(['-movflags +faststart', '-preset veryfast', '-crf 23'])
          .on('start', (cmd) => console.log('[VTR] ffmpeg concat start:', cmd))
          .on('stderr', (line) => console.log('[VTR] ffmpeg concat stderr:', line))
          .on('error', (e) => {
            console.error('VTR concat error:', e?.message || e);
            reject(e);
          })
          .on('end', () => {
            console.log('[VTR] ffmpeg concat done ->', finalPath);
            resolve();
          })
          .save(finalPath);
      });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'inline; filename="reel.mp4"');
    const stream = fs.createReadStream(finalPath);
    stream.on('close', () => {
      try { safeCleanup([uploadedFile.path]); } catch(_) {}
      // If we created a new final file via concat, clean it, else keep the single segment
      if (finalPath && (!segmentPaths.includes(finalPath))) {
        try { safeCleanup([finalPath]); } catch(_) {}
      }
      try { safeCleanup(segmentPaths.filter(p => p !== finalPath)); } catch(_) {}
      // Best-effort: remove any concat list files created in workDir
      try {
        const files = fs.readdirSync(workDir).filter(f => f.startsWith('list_') && f.endsWith('.txt'));
        safeCleanup(files.map(f => path.join(workDir, f)));
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

function matchSentencesToSegments(importantSentences, sentenceEntries, paddingSeconds) {
  const segments = [];
  for (const imp of importantSentences) {
    const normImp = normalizeText(imp);
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < sentenceEntries.length; i++) {
      const s = sentenceEntries[i];
      const normText = normalizeText(s.text || '');
      // Prefer substring containment
      const contains = normText.includes(normImp) || normImp.includes(normText);
      // score by token overlap
      const score = contains ? 1 : jaccardSimilarity(normImp, normText);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore > 0.08) {
      const se = sentenceEntries[bestIdx];
      const start = Math.max(0, se.startTime - paddingSeconds);
      const end = se.endTime + paddingSeconds;
      segments.push({ start, end });
    }
  }
  // Merge overlapping segments
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