const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

const validXfades = [
  'fade', 'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'circlecrop', 'circleopen', 'circleclose', 'rectcrop', 'distance', 'fadeblack', 'fadewhite', 'radial', 'zoom'
];
const DEFAULT_TRANSITION = 'fade';
const DEFAULT_TRANSITION_DURATION = 1; // seconds

const mergeReel = async (req, res) => {
  try {
    const { images, music, transition, totalDuration } = req.body;
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    if (!music) {
      return res.status(400).json({ error: 'No music file provided' });
    }
    if (!transition) {
      return res.status(400).json({ error: 'No transition provided' });
    }
    if (!totalDuration || isNaN(Number(totalDuration)) || Number(totalDuration) <= 0) {
      return res.status(400).json({ error: 'Invalid total duration' });
    }

    const n = images.length;
    const T = Number(totalDuration);
    const transitionType = validXfades.includes(transition) ? transition : DEFAULT_TRANSITION;
    const transitionDuration = DEFAULT_TRANSITION_DURATION;
    // Calculate per-image duration so that total video duration = T
    // (n-1) transitions, so each transition overlaps by transitionDuration
    // total = n*imgDur - (n-1)*transitionDuration => imgDur = (T + (n-1)*transitionDuration) / n
    const perImageDuration = (T + (n-1)*transitionDuration) / n;

    // Create temp dir
    const tempDir = path.join(os.tmpdir(), `ta1000series-reel-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Save images to temp files
    const imagePaths = [];
    for (let i = 0; i < n; i++) {
      const img = images[i];
      const imgPath = path.join(tempDir, `img${i}.jpg`);
      const base64Data = img.replace(/^data:[^;]+;base64,/, '');
      await fs.writeFile(imgPath, Buffer.from(base64Data, 'base64'));
      imagePaths.push(imgPath);
    }

    // Save music to temp file
    const musicPath = path.join(tempDir, 'music.mp3');
    const musicBase64 = music.replace(/^data:[^;]+;base64,/, '');
    await fs.writeFile(musicPath, Buffer.from(musicBase64, 'base64'));

    // Output path
    const outputPath = path.join(tempDir, `reel_${Date.now()}.mp4`);

    // Build ffmpeg args for xfade transitions
    const args = ['-y'];
    // Add image inputs
    imagePaths.forEach(img => {
      args.push('-loop', '1', '-t', perImageDuration.toString(), '-i', img);
    });
    // Add music input, trim to totalDuration
    args.push('-ss', '0', '-t', T.toString(), '-i', musicPath);

    // Build filter_complex for xfade transitions
    let filter = '';
    // Scale and pad all images
    for (let i = 0; i < n; i++) {
      filter += `[${i}:v]scale=1080:1920,setsar=1[v${i}];`;
    }
    // Chain xfade transitions
    if (n === 1) {
      filter += `[v0]format=yuv420p[video]`;
    } else {
      filter += `[v0][v1]xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${perImageDuration - transitionDuration}[vx1];`;
      for (let i = 2; i < n; i++) {
        filter += `[vx${i-1}][v${i}]xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${(perImageDuration-transitionDuration)+(i-1)*(perImageDuration-transitionDuration)}[vx${i}];`;
      }
      filter += `[vx${n-1}]format=yuv420p[video]`;
    }

    args.push('-filter_complex', filter);
    args.push('-map', '[video]');
    args.push('-map', `${n}:a`); // music input
    args.push('-t', T.toString()); // ensure output duration
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputPath);

    // Run ffmpeg
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegStatic, args);
      ff.stderr.on('data', data => console.log('ffmpeg:', data.toString()));
      ff.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg failed')));
    });

    // Read output video
    const videoBuffer = await fs.readFile(outputPath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="reel.mp4"');
    res.end(videoBuffer);

    // Cleanup
    for (const img of imagePaths) await fs.unlink(img);
    await fs.unlink(musicPath);
    await fs.unlink(outputPath);
    await fs.rmdir(tempDir);
  } catch (err) {
    console.error('mergeReel error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { mergeReel };