const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const os = require('os');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

// Helper function to get video duration
const getVideoDuration = async (videoPath) => {
    const probeArgs = ['-i', videoPath, '-show_entries', 'format=duration', '-v', 'quiet', '-of', 'csv=p=0'];
    const probe = spawn(ffprobeStatic.path, probeArgs);
    let duration = '';
    for await (const chunk of probe.stdout) { 
        duration += chunk; 
    }
    await new Promise(resolve => probe.on('close', resolve));
    return parseFloat(duration.trim()) || 0;
};

// POST /api/video/overlay
// Accepts: multipart/form-data with fields: mainVideo (video), overlayFile (video or image), overlayStart (seconds), overlayPosition, overlayDuration
// Returns: merged video file
const overlayVideo = async (req, res) => {
    try {
        if (!req.files || !req.files.mainVideo || !req.files.overlayFile) {
            return res.status(400).json({ error: 'Both mainVideo and overlayFile are required.' });
        }
        const mainVideoPath = req.files.mainVideo[0].path;
        const overlayFilePath = req.files.overlayFile[0].path;
        const overlayMime = req.files.overlayFile[0].mimetype;
        const overlayStart = parseFloat((req.body.overlayStart || '0').replace(',', '.')) || 0;
        const overlayPosition = req.body.overlayPosition || 'bottom-left';
        const overlayDuration = parseFloat((req.body.overlayDuration || '0').replace(',', '.')) || 0;

        // Validate overlay duration
        if (overlayDuration <= 0) {
            return res.status(400).json({ error: 'Overlay duration must be greater than 0.' });
        }

        // Output file
        const tempDir = path.resolve(__dirname, '../temp');
        await fs.mkdir(tempDir, { recursive: true });
        const outputPath = path.join(tempDir, `output-${Date.now()}.mp4`);

        // Determine overlay filter position
        let overlayFilter;
        if (overlayPosition === 'bottom-left') {
            overlayFilter = '20:H-h-20';
        } else if (overlayPosition === 'bottom-right') {
            overlayFilter = 'W-w-20:H-h-20';
        } else if (overlayPosition === 'full-screen') {
            overlayFilter = '0:0';
        } else {
            overlayFilter = '20:H-h-20'; // default to bottom-left
        }

        let ffmpegArgs;

        // Check if overlay file is an image or video
        if (overlayMime.startsWith('image/')) {
            // ========== IMAGE OVERLAY LOGIC ==========
            // Image should play for the specified duration
            console.log('Processing IMAGE overlay...');
            console.log(`Image overlay duration: ${overlayDuration} seconds`);
            
            // Get main video duration
            const mainDuration = await getVideoDuration(mainVideoPath);
            const overlayEnd = overlayStart + overlayDuration;
            
            let filterComplex;
            if (overlayPosition === 'full-screen') {
                // Full-screen image overlay
                filterComplex = `[1][0]scale2ref=w=iw:h=ih[ol][base];[base][ol]overlay=0:0:enable='between(t,${overlayStart},${overlayEnd})':format=auto`;
            } else {
                // Scaled image overlay (1/4 size)
                filterComplex = `[1:v]scale=iw/4:ih/4[ovrl];[0:v][ovrl]overlay=${overlayFilter}:enable='between(t,${overlayStart},${overlayEnd})':format=auto`;
            }
            
            ffmpegArgs = [
                '-y',
                '-i', mainVideoPath,
                '-loop', '1',
                '-i', overlayFilePath,
                '-t', mainDuration.toString(),
                '-filter_complex', filterComplex,
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac',
                '-b:a', '128k',
                outputPath
            ];
            
        } else if (overlayMime.startsWith('video/')) {
            // ========== VIDEO OVERLAY LOGIC ==========
            // Video should play for the specified duration
            console.log('Processing VIDEO overlay...');
            
            // Get overlay video duration for reference
            const overlayVideoDuration = await getVideoDuration(overlayFilePath);
            
            console.log(`Overlay video original duration: ${overlayVideoDuration} seconds`);
            console.log(`Overlay will play for: ${overlayDuration} seconds`);
            console.log(`Overlay will start at: ${overlayStart}s`);
            
            // Get main video dimensions
            const probeMainArgs = ['-i', mainVideoPath, '-show_entries', 'stream=width,height', '-select_streams', 'v:0', '-v', 'quiet', '-of', 'csv=p=0'];
            const probeMain = spawn(ffprobeStatic.path, probeMainArgs);
            let dimensions = '';
            for await (const chunk of probeMain.stdout) { 
                dimensions += chunk; 
            }
            await new Promise(resolve => probeMain.on('close', resolve));
            const [width, height] = dimensions.trim().split(',').map(Number);
            
            console.log(`Main video dimensions: ${width}x${height}`);
            
            let filterComplex;
            if (overlayPosition === 'full-screen') {
                // Full-screen video overlay - scale overlay to exact main video dimensions
                filterComplex = `[1:v]scale=${width}:${height},setpts=PTS-STARTPTS+${overlayStart}/TB[scaled_delayed];[0:v][scaled_delayed]overlay=0:0:enable='between(t,${overlayStart},${overlayStart + overlayDuration})':format=auto`;
            } else {
                // Scaled video overlay with delay (quarter size)
                filterComplex = `[1:v]scale=${Math.floor(width/4)}:${Math.floor(height/4)},setpts=PTS-STARTPTS+${overlayStart}/TB[delayed_scaled];[0:v][delayed_scaled]overlay=${overlayFilter}:enable='between(t,${overlayStart},${overlayStart + overlayDuration})':eval=frame:format=auto`;
            }
            
            ffmpegArgs = [
                '-y',
                '-i', mainVideoPath,
                '-i', overlayFilePath,
                '-filter_complex', filterComplex,
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'copy',
                '-map', '0:a?',
                outputPath
            ];
            
        } else {
            throw new Error('Unsupported overlay file type. Only images and videos are supported.');
        }

        console.log('FFmpeg command:', ffmpegStatic, ffmpegArgs.join(' '));

        // Execute FFmpeg command
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegStatic, ffmpegArgs);
            
            ffmpeg.stderr.on('data', data => {
                console.log('FFmpeg stderr:', data.toString());
            });
            
            ffmpeg.on('close', code => {
                console.log(`FFmpeg process closed with code: ${code}`);
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg failed with code ${code}`));
                }
            });
            
            ffmpeg.on('error', (error) => {
                console.error('FFmpeg spawn error:', error);
                reject(error);
            });
        });

        // Send the output file
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="overlayed.mp4"');
        const fileBuffer = await fs.readFile(outputPath);
        res.end(fileBuffer);

        // Cleanup
        await fs.unlink(mainVideoPath);
        await fs.unlink(overlayFilePath);
        await fs.unlink(outputPath);
        await fs.rmdir(tempDir);
        
    } catch (error) {
        console.error('Overlay error:', error);
        res.status(500).json({ error: 'Failed to overlay video/image', message: error.message });
    }
};

module.exports = { overlayVideo };