const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeStatic = require('ffprobe-static');
const VideoStorageService = require('../../services/videoStorageService');
const https = require('https');
const http = require('http');

// Initialize video storage service
const videoStorage = new VideoStorageService();

// Set FFmpeg paths
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeStatic.path);

// Comprehensive cleanup function for temporary files
const cleanupTempFiles = (filePaths) => {
  console.log('Starting cleanup of temporary files...');
  let cleanedCount = 0;
  let failedCount = 0;
  
  filePaths.forEach(filePath => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        const stat = fs.lstatSync(filePath);
        if (stat.isDirectory()) {
          // Remove directories recursively
          fs.rmSync(filePath, { recursive: true, force: true });
          console.log(`✓ Removed directory: ${path.basename(filePath)}`);
        } else {
          fs.unlinkSync(filePath);
          console.log(`✓ Cleaned up: ${path.basename(filePath)}`);
        }
        cleanedCount++;
      }
    } catch (error) {
      console.warn(`✗ Failed to clean up ${path.basename(filePath)}:`, error.message);
      failedCount++;
    }
  });
  
  console.log(`Cleanup completed: ${cleanedCount} files removed, ${failedCount} failed`);
  return { cleanedCount, failedCount };
};

// Manual cleanup function for temp directory (can be called separately if needed)
const cleanupTempDirectory = () => {
  const tempDir = path.join(__dirname, '../temp');
  if (!fs.existsSync(tempDir)) {
    console.log('Temp directory does not exist, nothing to clean');
    return;
  }
  
  try {
    const files = fs.readdirSync(tempDir);
    const filePaths = files.map(file => path.join(tempDir, file));
    
    console.log(`Found ${files.length} files in temp directory`);
    const result = cleanupTempFiles(filePaths);
    
    if (result.cleanedCount > 0) {
      console.log(`Successfully cleaned ${result.cleanedCount} temporary files`);
    }
    
    return result;
  } catch (error) {
    console.error('Error during temp directory cleanup:', error);
    return { cleanedCount: 0, failedCount: 1 };
  }
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

// Function to detect if text contains Hindi characters
const containsHindiText = (text) => {
  if (!text) return false;
  // Hindi Unicode range: \u0900-\u097F
  return /[\u0900-\u097F]/.test(text);
};

// Function to get appropriate font for text (Hindi or English)
const getFontForText = (text) => {
  if (containsHindiText(text)) {
    // Use a font that supports Hindi characters
    // Try system fonts that commonly support Hindi
    const hindiFonts = [
      'Arial Unicode MS',
      'Nirmala UI',
      'Mangal',
      'Kokila',
      'Arial',
      'DejaVu Sans'
    ];
    
    // For FFmpeg, we'll use a generic approach that should work
    return 'Arial Unicode MS';
  } else {
    // Use default font for English text
    return 'Arial';
  }
};

// Function to download a file
const downloadFile = (url, filepath) => {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    const file = fs.createWriteStream(filepath);
    
    protocol.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filepath);
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {}); // Delete the file async
      reject(err);
    });
  });
};

// Function to get font file path for Hindi text
const getHindiFontPath = async () => {
  const platform = process.platform;
  const possibleFonts = [];
  
  if (platform === 'win32') {
    // Windows font paths - more comprehensive list
    possibleFonts.push(
      'C:/Windows/Fonts/arial.ttf',
      'C:/Windows/Fonts/calibri.ttf',
      'C:/Windows/Fonts/msyh.ttf',
      'C:/Windows/Fonts/msgothic.ttc',
      'C:/Windows/Fonts/arialuni.ttf',
      'C:/Windows/Fonts/calibri.ttf',
      'C:/Windows/Fonts/cambria.ttc',
      'C:/Windows/Fonts/consola.ttf'
    );
  } else if (platform === 'darwin') {
    // macOS font paths
    possibleFonts.push(
      '/System/Library/Fonts/Arial Unicode.ttf',
      '/System/Library/Fonts/Arial.ttf',
      '/Library/Fonts/Arial Unicode MS.ttf',
      '/System/Library/Fonts/Helvetica.ttc',
      '/System/Library/Fonts/Menlo.ttc'
    );
  } else {
    // Linux font paths
    possibleFonts.push(
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf',
      '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf'
    );
  }
  
  // Check if any of these fonts exist
  for (const fontPath of possibleFonts) {
    if (fs.existsSync(fontPath)) {
      console.log(`Found Hindi-compatible font: ${fontPath}`);
      return fontPath;
    }
  }
  
  // If no system font found, try to download a Hindi-compatible font
  const tempDir = path.join(__dirname, '../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const downloadedFontPath = path.join(tempDir, 'hindi-font.ttf');
  
  // Check if we already downloaded the font
  if (fs.existsSync(downloadedFontPath)) {
    console.log(`Using previously downloaded Hindi font: ${downloadedFontPath}`);
    return downloadedFontPath;
  }
  
  // Try to download a Hindi-compatible font (Google Fonts - Noto Sans Devanagari)
  try {
    console.log('Downloading Hindi-compatible font...');
    const fontUrl = 'https://github.com/google/fonts/raw/main/ofl/notosansdevanagari/NotoSansDevanagari-Regular.ttf';
    await downloadFile(fontUrl, downloadedFontPath);
    console.log(`Downloaded Hindi font: ${downloadedFontPath}`);
    return downloadedFontPath;
  } catch (error) {
    console.warn('Failed to download Hindi font:', error.message);
    console.warn('Using default font for Hindi text');
    return null;
  }
};

// Function to create a more robust drawtext filter for Hindi text
const createHindiDrawtextFilter = (text, fontPath) => {
  // Escape special characters in text for FFmpeg
  const escapedText = text
    .replace(/'/g, "\\'")
    .replace(/:/g, ' ')
    .replace(/;/g, ',')
    .replace(/\\/g, '/')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/%/g, 'percent')
    .replace(/=/g, ' equals ');
  
  if (fontPath) {
    // Use fontfile with proper escaping
    return `drawtext=text='${escapedText}':fontfile='${fontPath.replace(/\\/g, '/')}':fontcolor=0xFFFFFF:fontsize=40:box=1:boxcolor=black@0.8:boxborderw=8:x=(w-text_w)/2:y=(h-text_h-250):line_spacing=8:enable='between(t,0,999999)'`;
  } else {
    // Fallback without fontfile
    return `drawtext=text='${escapedText}':fontcolor=0xFFFFFF:fontsize=35:box=1:boxcolor=black@0.9:boxborderw=10:x=(w-text_w)/2:y=(h-text_h-250):enable='between(t,0,999999)'`;
  }
};

// Function to create a text overlay using a different approach
const createTextOverlayImage = async (text, tempDir, index) => {
  try {
    // Create a simple text overlay using ImageMagick or similar
    // For now, we'll use a simple approach with FFmpeg text2image
    const textImagePath = path.join(tempDir, `text_overlay_${index}.png`);
    
    // Create a simple colored background with text
    const escapedText = text.replace(/'/g, "\\'").replace(/"/g, '\\"');
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input('color=c=black:s=1080x200:d=1')
        .inputFormat('lavfi')
        .outputOptions([
          '-vf', `drawtext=text='${escapedText}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2`,
          '-frames:v', '1',
          '-y'
        ])
        .output(textImagePath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    return textImagePath;
  } catch (error) {
    console.warn('Failed to create text overlay image:', error.message);
    return null;
  }
};

const generateFinalVideo = async (req, res) => {
  try {
    // Clean up any leftover files from previous runs
    console.log('Cleaning up any leftover files from previous runs...');
    cleanupTempDirectory();
    
    // Accept a separate SRT for image timing (imageSrt), keeping srt for overlay text
    const { images, audio, srt, imageSrt, deepSrt } = req.body;
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    
    if (!audio) {
      return res.status(400).json({ error: 'No audio provided' });
    }

    if (!srt) {
      return res.status(400).json({ error: 'No overlay SRT provided' });
    }

    // imageSrt is required for image timing; fall back to deepSrt alias if provided
    const imageTimingSrt = imageSrt || deepSrt;
    if (!imageTimingSrt) {
      return res.status(400).json({ error: 'No Deepgram SRT provided for image timing (imageSrt)' });
    }

    console.log('Video generation request received:', {
      imageCount: images.length,
      hasAudio: !!audio,
      hasOverlaySRT: !!srt,
      hasImageTimingSRT: !!imageTimingSrt
    });

    // Create temporary directory for processing
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Save audio file
    const audioBuffer = Buffer.from(audio, 'base64');
    const audioPath = path.join(tempDir, 'input_audio.mp3');
    fs.writeFileSync(audioPath, audioBuffer);

    // Get audio duration using ffprobe
    const getAudioDuration = () => new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata.format.duration);
      });
    });

    const audioDuration = await getAudioDuration();
    console.log('Audio duration:', audioDuration, 'seconds');

    // Parse SRT to extract timing and text
    const parseSRT = (srtContent) => {
      const entries = [];
      const blocks = srtContent.trim().split('\n\n');
      
      blocks.forEach(block => {
        const lines = block.split('\n');
        if (lines.length >= 2) {
          const timeLine = lines[1];
          const text = lines.slice(2).join(' ').trim();
          
          // Parse time format: 00:00:00,000 --> 00:00:03,000
          const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
          if (timeMatch) {
            const startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
            const endTime = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
            entries.push({ startTime, endTime, text });
          }
        }
      });
      
      return entries;
    };

    // Entries used for text overlay
    const overlaySrtEntries = parseSRT(srt);
    console.log('Overlay SRT entries:', overlaySrtEntries.length);

    // Entries used for image timing (Deepgram SRT preferred)
    let imageTimingEntries = parseSRT(imageTimingSrt);
    console.log('Image timing SRT entries:', imageTimingEntries.length);
    // Fallback: if no entries, synthesize timing based on audio duration and image count
    if (!imageTimingEntries || imageTimingEntries.length === 0) {
      console.warn('No image timing SRT entries found. Falling back to even distribution.');
      const evenDuration = audioDuration / images.length;
      imageTimingEntries = images.map((_, idx) => ({
        startTime: Math.max(0, idx * evenDuration),
        endTime: Math.min(audioDuration, (idx + 1) * evenDuration),
        text: ''
      }));
      console.log('Synthesized image timing entries:', imageTimingEntries.length);
    }

    // Group SRT entries into sentences for image timing
    const groupSRTIntoSentences = (entries) => {
      const sentences = [];
      let currentSentence = null;
      
      entries.forEach((entry, idx) => {
        const text = (entry.text || '').trim();
        const endsSentence = /[.!?]$/.test(text);
        
        if (!currentSentence) {
          currentSentence = {
            startTime: entry.startTime,
            endTime: entry.endTime,
            text: text
          };
        } else {
          currentSentence.endTime = entry.endTime;
          if (text.length > 0) {
            currentSentence.text += (currentSentence.text ? ' ' : '') + text;
          }
        }
        
        if (endsSentence || idx === entries.length - 1) {
          sentences.push(currentSentence);
          currentSentence = null;
        }
      });
      
      return sentences;
    };

    const sentenceTimings = groupSRTIntoSentences(imageTimingEntries);
    console.log('Grouped into sentences:', sentenceTimings.length);

    // Build durations that exactly sum to audioDuration with better precision
    let rawDurations = sentenceTimings.map(s => Math.max(0.1, (s.endTime - s.startTime)));
    let sumRaw = rawDurations.reduce((a, b) => a + b, 0);
    
    if (sumRaw <= 0) {
      // Fallback: distribute evenly
      rawDurations = new Array(sentenceTimings.length).fill(audioDuration / Math.max(1, sentenceTimings.length));
      sumRaw = audioDuration;
    }

    // Scale durations to match audio duration exactly
    const scale = audioDuration / sumRaw;
    let scaledDurations = rawDurations.map(d => Math.max(0.05, d * scale));
    
    // Fix rounding drift: adjust all durations proportionally to ensure exact sum
    const currentSum = scaledDurations.reduce((a, b) => a + b, 0);
    const adjustment = audioDuration / currentSum;
    scaledDurations = scaledDurations.map(d => d * adjustment);
    
    // Final verification and correction
    const finalSum = scaledDurations.reduce((a, b) => a + b, 0);
    const diff = audioDuration - finalSum;
    if (Math.abs(diff) > 0.001) {
      // Add the difference to the last duration
      scaledDurations[scaledDurations.length - 1] += diff;
    }

    const verifySum = scaledDurations.reduce((a, b) => a + b, 0);
    console.log(`Image durations: Sum=${verifySum.toFixed(6)}s, Target=${audioDuration.toFixed(6)}s, Diff=${(verifySum - audioDuration).toFixed(6)}s`);

    // Ensure we have enough images for all sentences
    if (sentenceTimings.length > images.length) {
      console.warn(`More sentences (${sentenceTimings.length}) than images (${images.length}). Some sentences will reuse the last image.`);
    }

    // Validate that we have at least one image
    if (images.length === 0) {
      return res.status(400).json({ error: 'No images provided for video generation' });
    }

    // Validate image data
    for (let i = 0; i < images.length; i++) {
      if (!images[i].image || typeof images[i].image !== 'string') {
        return res.status(400).json({ error: `Invalid image data at index ${i}` });
      }
    }

    // Save images and create input file for FFmpeg using sentence timing
    const imagePaths = [];
    const inputFile = path.join(tempDir, 'input.txt');
    let inputContent = '';
    let cumulativeTime = 0;
    
    // Function to convert and validate image
    const processImage = async (imageBuffer, index) => {
      const tempImagePath = path.join(tempDir, `temp_image_${index}.jpg`);
      const finalImagePath = path.join(tempDir, `image_${index}.jpg`);
      
      // First save the original image
      fs.writeFileSync(tempImagePath, imageBuffer);
      
      // Convert to proper format and dimensions using FFmpeg
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(tempImagePath)
          .outputOptions([
            '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
            '-frames:v', '1',
            '-y'
          ])
          .output(finalImagePath)
          .on('end', () => {
            // Clean up temp file
            if (fs.existsSync(tempImagePath)) {
              fs.unlinkSync(tempImagePath);
            }
            resolve();
          })
          .on('error', (err) => {
            console.warn(`Failed to process image ${index}, using original:`, err.message);
            // If processing fails, use original image
            if (fs.existsSync(tempImagePath)) {
              fs.copyFileSync(tempImagePath, finalImagePath);
              fs.unlinkSync(tempImagePath);
            }
            resolve();
          })
          .run();
      }); 
      
      return finalImagePath;
    };
    
    // Process all images
    for (let index = 0; index < sentenceTimings.length; index++) {
      const imageIndex = Math.min(index, images.length - 1); // Reuse last image if needed
      const imageBuffer = Buffer.from(images[imageIndex].image, 'base64');
      
      try {
        const imagePath = await processImage(imageBuffer, index);
        imagePaths.push(imagePath);
        
        const sentenceDuration = scaledDurations[index];
        cumulativeTime += sentenceDuration;
        
        // Add image to input file with sentence duration (high precision)
        inputContent += `file '${imagePath}'\n`;
        inputContent += `duration ${sentenceDuration.toFixed(6)}\n`;
        
        console.log(`Image ${imageIndex} -> sentence ${index + 1}: ${sentenceDuration.toFixed(3)}s (cumulative: ${cumulativeTime.toFixed(3)}s) ${sentenceTimings[index].text?.substring(0, 60) || ''}`);
      } catch (error) {
        console.error(`Failed to process image ${index}:`, error);
        // Create a simple fallback image
        const fallbackImagePath = path.join(tempDir, `image_${index}.jpg`);
        const fallbackBuffer = Buffer.from(images[imageIndex].image, 'base64');
        fs.writeFileSync(fallbackImagePath, fallbackBuffer);
        imagePaths.push(fallbackImagePath);
        
        const sentenceDuration = scaledDurations[index];
        cumulativeTime += sentenceDuration;
        
        inputContent += `file '${fallbackImagePath}'\n`;
        inputContent += `duration ${sentenceDuration.toFixed(6)}\n`;
        
        console.log(`Using fallback image ${imageIndex} -> sentence ${index + 1}: ${sentenceDuration.toFixed(3)}s`);
      }
    }

    // IMPORTANT: For concat demuxer, ensure the last image has file line but avoid extra duration line at end
    if (imagePaths.length > 0) {
      const lastPath = imagePaths[imagePaths.length - 1];
      inputContent += `file '${lastPath}'\n`;
    }

    fs.writeFileSync(inputFile, inputContent);
    console.log('Total expected video duration:', cumulativeTime.toFixed(6), 'seconds');

    // First pass: create video from images and audio (no drawtext)
    const tempVideoPath = path.join(tempDir, `temp_output_${Date.now()}.mp4`);
    // Add buffer to video duration to prevent truncation
    const extendedDuration = audioDuration + 3.0; // 3 seconds buffer
    
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(inputFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .input(audioPath)
        .outputOptions([
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-pix_fmt', 'yuv420p',
          '-r', '30',
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
          '-preset', 'medium',
          '-crf', '23',
          '-y'
        ])
        .duration(extendedDuration) // Use extended duration
        .output(tempVideoPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg first pass command:', commandLine);
        })
        .on('progress', (progress) => {
          console.log('First pass processing: ' + progress.percent + '% done');
        })
        .on('end', () => {
          console.log('First pass (video+audio) completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('FFmpeg first pass error:', err);
          reject(err);
        })
        .run();
    });

    // NEW APPROACH: Create individual text overlay videos and then concatenate them
    const overlayVideoPaths = [];
    
    // Prepare overlay data with extended timing
    const adjustedOverlay = overlaySrtEntries.map((entry, idx) => {
      const isLast = idx === overlaySrtEntries.length - 1;
      let endTime = entry.endTime;
      
      // For last entry, ensure it extends to audio end + buffer
      if (isLast) {
        endTime = Math.max(entry.endTime, extendedDuration);
      }
      
      return {
        startTime: Math.max(0, entry.startTime),
        endTime: endTime,
        text: entry.text || ''
      };
    });

    console.log('Creating individual overlay segments...');
    
    // Process each text overlay as a separate segment
    for (let i = 0; i < adjustedOverlay.length; i++) {
      const entry = adjustedOverlay[i];
      const segmentPath = path.join(tempDir, `segment_${i}_${Date.now()}.mp4`);
      
      if (entry.text.trim()) {
        console.log(`Creating segment ${i + 1}/${adjustedOverlay.length}: ${entry.startTime.toFixed(3)}s - ${entry.endTime.toFixed(3)}s`);
        console.log(`Original text: "${entry.text}"`);
        
        // Extract segment from base video
        const segmentDuration = entry.endTime - entry.startTime;
        
        // Clean text for FFmpeg drawtext
        const cleanText = cleanTextForDrawtext(entry.text);
        console.log(`Cleaned text: "${cleanText}"`);
        
        // Skip empty text after cleaning
        if (!cleanText.trim()) {
          console.log(`Skipping segment ${i + 1} - no text after cleaning`);
          continue;
        }

        // Get appropriate font for the text
        const fontFamily = getFontForText(cleanText);
        const isHindi = containsHindiText(cleanText);
        console.log(`Text language: ${isHindi ? 'Hindi' : 'English'}, Font: ${fontFamily}`);
        
        // Create drawtext filter with appropriate font and settings
        let drawtextFilter;
        if (isHindi) {
          // Hindi text needs special handling
          try {
            const hindiFontPath = await getHindiFontPath();
            console.log(`Using Hindi font path: ${hindiFontPath}`);
            drawtextFilter = createHindiDrawtextFilter(cleanText, hindiFontPath);
          } catch (error) {
            console.warn('Failed to get Hindi font path:', error.message);
            // Use simple fallback
            drawtextFilter = createHindiDrawtextFilter(cleanText, null);
          }
        } else {
          // English text
          drawtextFilter = `drawtext=text='${cleanText}':fontcolor=0xFFFFFF:fontsize=45:box=1:boxcolor=black@0.8:boxborderw=8:x=(w-text_w)/2:y=(h-text_h-250):line_spacing=10`;
        }
        
        await new Promise((resolve, reject) => {
          const ffmpegCommand = ffmpeg()
            .input(tempVideoPath)
            .inputOptions(['-ss', entry.startTime.toString()])
            .outputOptions([
              '-t', segmentDuration.toString(),
              '-vf', drawtextFilter,
              '-c:v', 'libx264',
              '-c:a', 'copy',
              '-avoid_negative_ts', 'make_zero',
              '-y'
            ])
            .output(segmentPath);

          ffmpegCommand
            .on('start', (commandLine) => {
              console.log(`Segment ${i + 1} FFmpeg command:`, commandLine);
            })
            .on('end', () => {
              console.log(`Segment ${i + 1} completed`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`Segment ${i + 1} error:`, err);
              
              // If Hindi text failed, try alternative approach
              if (isHindi) {
                console.log(`Trying alternative approach for Hindi text in segment ${i + 1}`);
                
                // Try multiple alternative approaches for Hindi text
                const alternativeApproaches = [
                  // Approach 1: Simple drawtext without font specification
                  `drawtext=text='${cleanText}':fontcolor=0xFFFFFF:fontsize=35:box=1:boxcolor=black@0.9:boxborderw=10:x=(w-text_w)/2:y=(h-text_h-250)`,
                  
                  // Approach 2: Using different font specification
                  `drawtext=text='${cleanText}':font='Arial':fontcolor=0xFFFFFF:fontsize=35:box=1:boxcolor=black@0.9:boxborderw=10:x=(w-text_w)/2:y=(h-text_h-250)`,
                  
                  // Approach 3: Using subtitle filter
                  `subtitles=text='${cleanText}':fontcolor=white:fontsize=35:force_style='FontName=Arial,FontSize=35,PrimaryColour=&Hffffff,OutlineColour=&H000000,BackColour=&H80000000,Bold=1,Outline=2'`,
                  
                  // Approach 4: Using ass subtitle format
                  `ass=text='${cleanText}'`,
                  
                  // Approach 5: Using a very simple drawtext with minimal parameters
                  `drawtext=text='${cleanText}':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=(h-text_h-250)`
                ];
                
                let currentApproach = 0;
                
                const tryNextApproach = () => {
                  if (currentApproach >= alternativeApproaches.length) {
                    console.error(`All alternative approaches failed for segment ${i + 1}`);
                    reject(new Error('All Hindi text rendering approaches failed'));
                    return;
                  }
                  
                  const alternativeFilter = alternativeApproaches[currentApproach];
                  console.log(`Trying approach ${currentApproach + 1} for Hindi text:`, alternativeFilter);
                  
                  ffmpeg()
                    .input(tempVideoPath)
                    .inputOptions(['-ss', entry.startTime.toString()])
                    .outputOptions([
                      '-t', segmentDuration.toString(),
                      '-vf', alternativeFilter,
                      '-c:v', 'libx264',
                      '-c:a', 'copy',
                      '-avoid_negative_ts', 'make_zero',
                      '-y'
                    ])
                    .output(segmentPath)
                    .on('end', () => {
                      console.log(`Segment ${i + 1} completed with approach ${currentApproach + 1}`);
                      resolve();
                    })
                    .on('error', (altErr) => {
                      console.error(`Approach ${currentApproach + 1} failed for segment ${i + 1}:`, altErr.message);
                      currentApproach++;
                      tryNextApproach();
                    })
                    .run();
                };
                
                tryNextApproach();
              } else {
                reject(err);
              }
            })
            .run();
        });
        
        overlayVideoPaths.push({ path: segmentPath, startTime: entry.startTime, endTime: entry.endTime });
      }
    }

    // Second pass: Merge all segments back into final video
    const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);
    
    if (overlayVideoPaths.length > 0) {
      console.log('Merging overlay segments...');
      
      // Create a complex filter to overlay all segments at their correct times
      let filterComplex = '[0:v]';
      let audioFilter = '[0:a]';
      
      overlayVideoPaths.forEach((segment, idx) => {
        const inputIndex = idx + 1;
        const overlayStart = segment.startTime;
        
        filterComplex += `[${inputIndex}:v]overlay=0:0:enable='between(t,${overlayStart.toFixed(6)},${segment.endTime.toFixed(6)})'`;
        
        if (idx < overlayVideoPaths.length - 1) {
          filterComplex += `[tmp${idx}];[tmp${idx}]`;
        }
      });
      
      await new Promise((resolve, reject) => {
        const command = ffmpeg()
          .input(tempVideoPath);
        
        // Add all overlay segments as inputs
        overlayVideoPaths.forEach(segment => {
          command.input(segment.path);
        });
        
        command
          .outputOptions([
            '-filter_complex', filterComplex,
            '-c:v', 'libx264',
            '-c:a', 'copy',
            '-preset', 'medium',
            '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-y'
          ])
          .duration(audioDuration) // Final duration should match audio
          .output(outputPath)
          .on('start', (commandLine) => {
            console.log('FFmpeg merge command:', commandLine);
          })
          .on('progress', (progress) => {
            console.log('Merge processing: ' + progress.percent + '% done');
          })
          .on('end', () => {
            console.log('Merge completed');
            resolve();
          })
          .on('error', (err) => {
            console.error('FFmpeg merge error:', err);
            reject(err);
          })
          .run();
      });
    } else {
      // No text overlays, just trim the base video to audio duration
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(tempVideoPath)
          .outputOptions(['-t', audioDuration.toString(), '-c', 'copy', '-y'])
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
    }

    // Verify final video duration
    const finalVideoDuration = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(outputPath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata.format.duration);
      });
    });
    
    console.log(`Final video duration: ${finalVideoDuration.toFixed(3)}s (target: ${audioDuration.toFixed(3)}s)`);

    // Read the generated video
    const videoBuffer = fs.readFileSync(outputPath);
    
    // Store video temporarily for 5 min
    let storageInfo;
    try {
      storageInfo = await videoStorage.storeVideo(videoBuffer, {
        duration: finalVideoDuration,
        audioDuration: audioDuration,
        imageCount: images.length,
        sentenceCount: sentenceTimings.length
      });
      console.log('Video stored temporarily:', storageInfo.filename);
    } catch (storageError) {
      console.error('Failed to store video:', storageError);
      // Continue with base64 fallback
    }

    // Clean up temporary processing files
    const allTempFiles = [
      ...imagePaths,
      audioPath,
      inputFile,
      tempVideoPath,
      outputPath,
      ...overlayVideoPaths.map(segment => segment.path)
    ];
    
    cleanupTempFiles(allTempFiles);

    // Prepare response
    const response = {
      success: true,
      duration: finalVideoDuration,
      audioDuration: audioDuration,
      imageCount: images.length,
      sentenceCount: sentenceTimings.length,
      durationMatch: Math.abs(finalVideoDuration - audioDuration) < 0.1
    };

    // If storage was successful, return video URL and filename
    if (storageInfo) {
      response.videoUrl = storageInfo.url;
      response.videoFilename = storageInfo.filename;
      response.expiryTime = storageInfo.expiryTime;
      response.video = videoBuffer.toString('base64'); // Keep base64 as fallback
    } else {
      // Fallback to base64 only
      response.video = videoBuffer.toString('base64');
    }

    res.json(response);

  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate video',
      details: error.message 
    });
  }
};

// Async version of generateFinalVideo for background processing
const generateFinalVideoAsync = async (requestData, options = {}) => {
  const { onProgress } = options;
  
  try {
    // Clean up any leftover files from previous runs
    console.log('Cleaning up any leftover files from previous runs...');
    cleanupTempDirectory();
    
    // Extract data from request
    const { images, audio, srt, imageSrt, deepSrt } = requestData;
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new Error('No images provided');
    }
    
    if (!audio) {
      throw new Error('No audio provided');
    }

    if (!srt) {
      throw new Error('No overlay SRT provided');
    }

    // imageSrt is required for image timing; fall back to deepSrt alias if provided
    const imageTimingSrt = imageSrt || deepSrt;
    if (!imageTimingSrt) {
      throw new Error('No Deepgram SRT provided for image timing (imageSrt)');
    }

    console.log('Async video generation started:', {
      imageCount: images.length,
      hasAudio: !!audio,
      hasOverlaySRT: !!srt,
      hasImageTimingSRT: !!imageTimingSrt
    });

    if (onProgress) onProgress(5, 'Initializing video generation...');
    console.log('[async-video] 5% Initializing at', new Date().toISOString());

    // Create temporary directory for processing
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    if (onProgress) onProgress(10, 'Processing audio...');
    console.log('[async-video] 10% Processing audio at', new Date().toISOString());

    // Save audio file
    const audioBuffer = Buffer.from(audio, 'base64');
    const audioPath = path.join(tempDir, 'input_audio.mp3');
    fs.writeFileSync(audioPath, audioBuffer);

    // Get audio duration using ffprobe
    const getAudioDuration = () => new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata.format.duration);
      });
    });

    const audioDuration = await getAudioDuration();
    console.log('Audio duration:', audioDuration, 'seconds');

    if (onProgress) onProgress(15, 'Processing SRT files...');
    console.log('[async-video] 15% Processing SRTs at', new Date().toISOString());

    // Parse SRT to extract timing and text
    const parseSRT = (srtContent) => {
      const lines = srtContent.trim().split('\n');
      const subtitles = [];
      
      for (let i = 0; i < lines.length; i += 4) {
        if (lines[i] && !isNaN(lines[i])) {
          const timeLine = lines[i + 1];
          const text = lines[i + 2];
          
          if (timeLine && text) {
            const [startTime, endTime] = timeLine.split(' --> ');
            if (startTime && endTime) {
              subtitles.push({
                start: parseTimeToSeconds(startTime),
                end: parseTimeToSeconds(endTime),
                text: text.trim()
              });
            }
          }
        }
      }
      
      return subtitles;
    };

    const parseTimeToSeconds = (timeStr) => {
      const [time, ms] = timeStr.split(',');
      const [hours, minutes, seconds] = time.split(':').map(Number);
      return hours * 3600 + minutes * 60 + seconds + ms / 1000;
    };

    const sentenceTimings = parseSRT(imageTimingSrt);
    const overlayTimings = parseSRT(srt);

    console.log(`Parsed ${sentenceTimings.length} image timing segments and ${overlayTimings.length} overlay segments`);

    if (onProgress) onProgress(20, 'Processing images...');
    console.log('[async-video] 20% Processing images count=', images.length);

    // Save images and create image sequence
    const imagePaths = [];
    for (let i = 0; i < images.length; i++) {
      // Accept either base64 string or object with { image: base64 }
      const rawImage = images[i];
      const base64Data = typeof rawImage === 'string' ? rawImage : (rawImage && rawImage.image);
      if (!base64Data || typeof base64Data !== 'string') {
        throw new Error(`Invalid image data at index ${i} - expected base64 string or { image: base64 }`);
      }
      const imageBuffer = Buffer.from(base64Data, 'base64');
      const imagePath = path.join(tempDir, `image_${i}.jpg`);
      fs.writeFileSync(imagePath, imageBuffer);
      imagePaths.push(imagePath);
    }

    if (onProgress) onProgress(30, 'Creating image sequence...');
    console.log('[async-video] 30% Creating image sequence at', new Date().toISOString());

    // Create image sequence based on sentence timings
    const inputFile = path.join(tempDir, 'input.txt');
    let inputContent = '';
    
    for (let i = 0; i < sentenceTimings.length; i++) {
      const timing = sentenceTimings[i];
      const imageIndex = i % images.length;
      const imagePath = imagePaths[imageIndex];
      const duration = timing.end - timing.start;
      
      inputContent += `file '${imagePath}'\n`;
      inputContent += `duration ${duration}\n`;
    }
    
    // Add the last image for the remaining duration
    if (sentenceTimings.length > 0) {
      const lastImageIndex = (sentenceTimings.length - 1) % images.length;
      const lastImagePath = imagePaths[lastImageIndex];
      inputContent += `file '${lastImagePath}'\n`;
    }
    
    fs.writeFileSync(inputFile, inputContent);

    if (onProgress) onProgress(40, 'Generating base video...');
    console.log('[async-video] 40% Base video (concat) start at', new Date().toISOString());

    // Create base video from image sequence
    const tempVideoPath = path.join(tempDir, 'temp_video.mp4');
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(inputFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-r', '30', '-pix_fmt', 'yuv420p', '-y'])
        .output(tempVideoPath)
        .on('start', (cmd) => {
          console.log('[ffmpeg-async] base video command:', cmd);
        })
        .on('progress', (p) => {
          console.log('[ffmpeg-async] base video progress:', p?.percent);
        })
        .on('end', () => {
          console.log('[ffmpeg-async] base video done at', new Date().toISOString());
          resolve();
        })
        .on('error', (err) => {
          console.error('[ffmpeg-async] base video error:', err?.message || err);
          reject(err);
        })
        .run();
    });

    if (onProgress) onProgress(60, 'Adding audio...');
    console.log('[async-video] 60% Adding audio / overlays prep at', new Date().toISOString());

    // Add audio to the video
    const outputPath = path.join(tempDir, 'final_video.mp4');
    
    if (overlayTimings.length > 0) {
      if (onProgress) onProgress(70, 'Rendering text overlays...');
      console.log('[async-video] 70% Rendering overlays segments=', overlayTimings.length);

      // Build drawtext filters directly on the base video, one per subtitle segment
      const drawFilters = [];
      // Use robust cleaner to avoid breaking filter_complex with special characters
      const makeSafeText = (t) => {
        const cleaned = cleanTextForDrawtext(t || '');
        // Extra hardening for ffmpeg drawtext: remove commas and semicolons which separate args
        // and brackets/equals/percent that can confuse parser
        return cleaned
          .replace(/,/g, ' ')
          .replace(/;/g, ',')
          .replace(/\[/g, '(')
          .replace(/\]/g, ')')
          .replace(/\{/g, '(')
          .replace(/\}/g, ')')
          .replace(/%/g, ' percent ')
          .replace(/=/g, ' equals ')
          .trim();
      };

      let lastLabel = '0:v';
      for (let i = 0; i < overlayTimings.length; i++) {
        const seg = overlayTimings[i];
        const safe = makeSafeText(seg.text);
        const outLabel = i === overlayTimings.length - 1 ? 'vout' : `v${i}`;
        // Bottom-centered with slight margin, minimal padding via boxborderw
        const filter = `[${lastLabel}]drawtext=text='${safe}':fontcolor=white:fontsize=42:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-text_w)/2:y=h-(text_h+220):enable='between(t,${seg.start},${seg.end})'[${outLabel}]`;
        drawFilters.push(filter);
        lastLabel = outLabel;
      }

      const complex = drawFilters.join(';');

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(tempVideoPath)
          .input(audioPath)
          .complexFilter(complex)
          .outputOptions(['-map', '[vout]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', audioDuration.toString(), '-y'])
          .output(outputPath)
          .on('start', (cmd) => {
            console.log('FFmpeg complex filter length:', complex.length);
            console.log('FFmpeg complex filter head:', complex.slice(0, 400));
            console.log('FFmpeg overlay (async) command:', cmd);
          })
          .on('progress', (p) => {
            console.log('[ffmpeg-async] overlays progress:', p?.percent);
          })
          .on('end', () => {
            console.log('[ffmpeg-async] overlays done at', new Date().toISOString());
            resolve();
          })
          .on('error', (err) => {
            console.error('[ffmpeg-async] overlays error:', err?.message || err);
            reject(err);
          })
          .run();
      });
    } else {
      // No text overlays, just trim the base video to audio duration
      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(tempVideoPath)
          .outputOptions(['-t', audioDuration.toString(), '-c', 'copy', '-y'])
          .output(outputPath)
          .on('start', (cmd) => {
            console.log('[ffmpeg-async] trim-only command:', cmd);
          })
          .on('progress', (p) => {
            console.log('[ffmpeg-async] trim-only progress:', p?.percent);
          })
          .on('end', () => {
            console.log('[ffmpeg-async] trim-only done at', new Date().toISOString());
            resolve();
          })
          .on('error', (err) => {
            console.error('[ffmpeg-async] trim-only error:', err?.message || err);
            reject(err);
          })
          .run();
      });
    }

    if (onProgress) onProgress(90, 'Finalizing video...');
    console.log('[async-video] 90% Finalizing at', new Date().toISOString());

    // Verify final video duration
    const finalVideoDuration = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(outputPath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata.format.duration);
      });
    });
    
    console.log(`Final video duration: ${finalVideoDuration.toFixed(3)}s (target: ${audioDuration.toFixed(3)}s)`);

    // Read the generated video
    const videoBuffer = fs.readFileSync(outputPath);

    // Clean up temporary processing files
    const allTempFiles = [
      ...imagePaths,
      audioPath,
      inputFile,
      tempVideoPath,
      outputPath,
      ...(overlayTimings.length > 0 ? overlayTimings.map((_, i) => path.join(tempDir, `overlay_${i}.mp4`)) : [])
    ];
    
    cleanupTempFiles(allTempFiles);

    if (onProgress) onProgress(100, 'Video generation completed!');
    console.log('[async-video] 100% Completed at', new Date().toISOString());

    // Return video data (without base64 for async processing)
    return {
      success: true,
      video: videoBuffer, // Return as Buffer for S3 upload
      duration: finalVideoDuration,
      audioDuration: audioDuration,
      imageCount: images.length,
      sentenceCount: sentenceTimings.length,
      durationMatch: Math.abs(finalVideoDuration - audioDuration) < 0.1
    };

  } catch (error) {
    console.error('Async video generation error:', error);
    throw error;
  }
};

module.exports = {
  generateFinalVideo,
  generateFinalVideoAsync,
  cleanupTempFiles,
  cleanupTempDirectory
};