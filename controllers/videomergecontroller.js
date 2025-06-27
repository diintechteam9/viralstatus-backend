const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { s3, BUCKET_NAME } = require("../config/s3");
const Datastore = require("../models/datastore");

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

// Test FFmpeg installation
const testFFmpeg = () => {
    return new Promise((resolve) => {
        const testProcess = spawn(ffmpegStatic, ['-version']);
        let output = '';
        
        testProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        testProcess.on('close', (code) => {
            if (code === 0) {
                console.log('FFmpeg test successful:', output.split('\n')[0]);
                resolve(true);
            } else {
                console.error('FFmpeg test failed with code:', code);
                resolve(false);
            }
        });
        
        testProcess.on('error', (error) => {
            console.error('FFmpeg test error:', error);
            resolve(false);
        });
    });
};

// Test endpoint to verify route is working
const testEndpoint = async (req, res) => {
    try {
        console.log('Test endpoint called');
        res.json({
            success: true,
            message: "Video merge endpoint is working",
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Test endpoint error:', error);
        res.status(500).json({
            error: "Test endpoint failed",
            message: error.message
        });
    }
};

// Merge videos using FFmpeg
const mergeVideos = async (req, res) => {
    try {
        console.log('=== MERGE VIDEOS REQUEST START ===');
        console.log('Request method:', req.method);
        console.log('Request headers:', req.headers);
        console.log('Request body keys:', Object.keys(req.body || {}));
        console.log('Request body size:', JSON.stringify(req.body).length);
        console.log('Client from request:', req.client);
        console.log('FFmpeg path:', ffmpegStatic);

        // Check if request body is empty or malformed
        if (!req.body || Object.keys(req.body).length === 0) {
            console.error('Request body is empty or malformed');
            return res.status(400).json({
                error: "Invalid request",
                message: "Request body is empty or malformed"
            });
        }
        console.log('Step 1: Request validation passed');

        // Validate FFmpeg installation
        try {
            console.log('Step 2: Starting FFmpeg validation');
            const fs = require('fs');
            if (!fs.existsSync(ffmpegStatic)) {
                console.error('FFmpeg not found at path:', ffmpegStatic);
                throw new Error(`FFmpeg not found at path: ${ffmpegStatic}`);
            }
            console.log('FFmpeg found and accessible');
            // Test FFmpeg functionality
            const ffmpegTestResult = await testFFmpeg();
            if (!ffmpegTestResult) {
                console.error('FFmpeg test failed - FFmpeg is not working properly');
                throw new Error('FFmpeg test failed - FFmpeg is not working properly');
            }
            console.log('Step 2: FFmpeg validation passed');
        } catch (ffmpegError) {
            console.error('FFmpeg validation error:', ffmpegError);
            return res.status(500).json({
                error: "FFmpeg not properly installed",
                message: ffmpegError.message
            });
        }

        console.log('Step 3: Extracting request body fields');
        const {
            mediaFiles,
            musicFiles,
            options,
            folder,
            userId,
            title,
            description
        } = req.body;

        // Validate required fields
        console.log('Extracted fields:', {
            mediaFilesCount: mediaFiles ? mediaFiles.length : 0,
            musicFilesCount: musicFiles ? musicFiles.length : 0,
            hasOptions: !!options,
            hasFolder: !!folder,
            hasUserId: !!userId
        });

        if (!mediaFiles || mediaFiles.length === 0) {
            console.error('No media files provided');
            return res.status(400).json({
                error: "No media files provided",
                message: "Please provide at least one media file"
            });
        }

        if (!folder || !userId) {
            console.error('Missing required information:', { folder: !!folder, userId: !!userId });
            return res.status(400).json({
                error: "Missing required information",
                message: "Please provide folder and user information"
            });
        }

        console.log('Step 3: Field validation passed');

        // Verify that the authenticated user matches the userId in the request
        console.log('Step 4: Starting authentication check');
        console.log('Authentication check:', {
            reqClientId: req.client ? req.client.id : 'undefined',
            reqClientType: req.client ? typeof req.client.id : 'undefined',
            requestUserId: userId,
            requestUserIdType: typeof userId,
            isEqual: req.client ? req.client.id === userId : false
        });
        
        if (req.client && req.client.id.toString() !== userId.toString()) {
            console.log('User mismatch:', { clientId: req.client.id, requestUserId: userId });
            return res.status(403).json({
                error: "Unauthorized",
                message: "You can only merge videos for your own account"
            });
        }

        console.log('Step 4: Authentication check passed');

        console.log('Starting video merge process...');
        console.log('Media files:', mediaFiles.length);
        console.log('Music files:', musicFiles ? musicFiles.length : 0);
        console.log('Options:', options);
        console.log('Folder:', folder);
        console.log('UserId:', userId);
        console.log('Full request body:', JSON.stringify(req.body, null, 2));

        // Log the first few media files for debugging
        if (mediaFiles.length > 0) {
            console.log('Sample media file:', {
                fileName: mediaFiles[0].fileName,
                fileData: mediaFiles[0].fileData ? `${mediaFiles[0].fileData.substring(0, 50)}...` : 'undefined',
                fileSize: mediaFiles[0].fileSize,
                mimeType: mediaFiles[0].mimeType
            });
        }

        console.log('Step 5: Creating temporary directory');
        // Create temporary directory
        const tempDir = path.join(os.tmpdir(), `video-merge-${Date.now()}`);
        console.log('Creating temporary directory:', tempDir);
        await fs.mkdir(tempDir, { recursive: true });
        console.log('Step 5: Temporary directory created');

        try {
            console.log('Step 6: Processing media files');
            // Handle inrow and outrow images if options are set
            const backendAssetsPath = path.join(__dirname, '../assets');
            const inrowImagePath = path.join(backendAssetsPath, 'inrow', 'inrow.png');
            const outrowImagePath = path.join(backendAssetsPath, 'outrow', 'outrow.png');
            const inrowDuration = 2; // seconds
            const outrowDuration = 2; // seconds

            // Prepare a new array to hold the possibly modified mediaFiles
            let processedMediaFiles = [...mediaFiles];

            // Add more detailed logs here for each step of processing
            console.log('Step 6.1: Checking for inrow/outrow options');
            // Prepend inrow if needed
            if (options && options.showInrow) {
                try {
                    const inrowTempPath = path.join(tempDir, 'inrow.png');
                    await fs.copyFile(inrowImagePath, inrowTempPath);
                    processedMediaFiles.unshift({
                        fileName: 'inrow.png',
                        fileData: null,
                        filePath: inrowTempPath,
                        mimeType: 'image/png',
                        duration: inrowDuration
                    });
                    console.log('Inrow image added to media files');
                } catch (err) {
                    console.error('Failed to add inrow image:', err);
                }
            }

            // Append outrow if needed
            if (options && options.showOutrow) {
                try {
                    const outrowTempPath = path.join(tempDir, 'outrow.png');
                    await fs.copyFile(outrowImagePath, outrowTempPath);
                    processedMediaFiles.push({
                        fileName: 'outrow.png',
                        fileData: null,
                        filePath: outrowTempPath,
                        mimeType: 'image/png',
                        duration: outrowDuration
                    });
                    console.log('Outrow image added to media files');
                } catch (err) {
                    console.error('Failed to add outrow image:', err);
                }
            }

            // --- DURATION LOGIC FOR 14 SECONDS ---
            // Calculate available time for random images
            const totalDuration = 14;
            let fixedDuration = 0;
            if (options && options.showInrow) fixedDuration += inrowDuration;
            if (options && options.showOutrow) fixedDuration += outrowDuration;
            const randomImages = processedMediaFiles.filter(f => f.fileName !== 'inrow.png' && f.fileName !== 'outrow.png');
            let availableTime = totalDuration - fixedDuration;
            let perImageDuration = 2;
            let maxRandomImages = Math.floor(availableTime / perImageDuration);
            let trimmedRandomImages = randomImages.slice(0, maxRandomImages);
            // If fewer images, stretch their duration
            if (trimmedRandomImages.length > 0 && trimmedRandomImages.length * perImageDuration < availableTime) {
                perImageDuration = availableTime / trimmedRandomImages.length;
            }
            // Set durations
            trimmedRandomImages = trimmedRandomImages.map(img => ({ ...img, duration: perImageDuration }));
            // Rebuild processedMediaFiles with inrow, trimmed randoms, outrow
            processedMediaFiles = [];
            if (options && options.showInrow) processedMediaFiles.push({
                fileName: 'inrow.png',
                fileData: null,
                filePath: path.join(tempDir, 'inrow.png'),
                mimeType: 'image/png',
                duration: inrowDuration
            });
            processedMediaFiles = processedMediaFiles.concat(trimmedRandomImages);
            if (options && options.showOutrow) processedMediaFiles.push({
                fileName: 'outrow.png',
                fileData: null,
                filePath: path.join(tempDir, 'outrow.png'),
                mimeType: 'image/png',
                duration: outrowDuration
            });

            // Handle logo overlay if options are set
            let logoTempPath = null;
            let logoInputIndex = null;
            if (options && options.showLogo) {
                try {
                    const logoImagePath = path.join(backendAssetsPath, 'logo', 'logo.png');
                    logoTempPath = path.join(tempDir, 'logo.png');
                    await fs.copyFile(logoImagePath, logoTempPath);
                    console.log('Logo image added for overlay:', logoTempPath);
                } catch (err) {
                    console.error('Failed to add logo image:', err);
                }
            }

            // Use processedMediaFiles for the rest of the logic
            // Download all media files
            const mediaFilePaths = [];
            for (let i = 0; i < processedMediaFiles.length; i++) {
                const mediaFile = processedMediaFiles[i];
                // If filePath is set (for inrow/outrow), just use it
                if (mediaFile.filePath) {
                    mediaFilePaths.push(mediaFile.filePath);
                    console.log(`Added static image for media file ${i + 1}: ${mediaFile.filePath}`);
                    continue;
                }
                
                // Validate fileName and provide fallback
                let fileName = mediaFile.fileName || `media_${i}`;
                let extension = '.mp4'; // Default extension
                
                if (fileName && fileName !== `media_${i}`) {
                    try {
                        extension = path.extname(fileName);
                        if (!extension) {
                            extension = '.mp4';
                        }
                    } catch (e) {
                        extension = '.mp4';
                    }
                }
                
                const filePath = path.join(tempDir, `media_${i}${extension}`);
                
                console.log(`Processing media file ${i + 1}/${processedMediaFiles.length}: ${fileName}`);
                
                // Handle base64 data instead of URL
                if (mediaFile.fileData) {
                    try {
                        // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
                        const base64Data = mediaFile.fileData.replace(/^data:[^;]+;base64,/, '');
                        const buffer = Buffer.from(base64Data, 'base64');
                        await fs.writeFile(filePath, buffer);
                        console.log(`Saved ${buffer.length} bytes for media file ${i + 1}`);
                    } catch (err) {
                        console.error(`Error writing media file ${i + 1}:`, err);
                        throw new Error(`Failed to write media file ${i + 1}: ${err.message}`);
                    }
                } else {
                    console.error(`No file data provided for media file ${i + 1}`);
                    throw new Error(`No file data provided for media file ${i + 1}`);
                }
                
                mediaFilePaths.push(filePath);
            }

            console.log('Step 6: Media files processed successfully');

            // Download music files if provided
            const musicFilePaths = [];
            if (musicFiles && musicFiles.length > 0) {
                console.log('Step 7: Processing music files');
                for (let i = 0; i < musicFiles.length; i++) {
                    const musicFile = musicFiles[i];
                    
                    // Validate fileName and provide fallback
                    let fileName = musicFile.fileName || `music_${i}`;
                    let extension = '.mp3'; // Default extension
                    
                    if (fileName && fileName !== `music_${i}`) {
                        try {
                            extension = path.extname(fileName);
                            if (!extension) {
                                extension = '.mp3';
                            }
                        } catch (e) {
                            extension = '.mp3';
                        }
                    }
                    
                    const filePath = path.join(tempDir, `music_${i}${extension}`);
                    
                    console.log(`Processing music file ${i + 1}/${musicFiles.length}: ${fileName}`);
                    
                    // Handle base64 data instead of URL
                    if (musicFile.fileData) {
                        try {
                            // Remove data URL prefix (e.g., "data:audio/mpeg;base64,")
                            const base64Data = musicFile.fileData.replace(/^data:[^;]+;base64,/, '');
                            const buffer = Buffer.from(base64Data, 'base64');
                            await fs.writeFile(filePath, buffer);
                            console.log(`Saved ${buffer.length} bytes for music file ${i + 1}`);
                        } catch (err) {
                            console.error(`Error writing music file ${i + 1}:`, err);
                            throw new Error(`Failed to write music file ${i + 1}: ${err.message}`);
                        }
                    } else {
                        console.error(`No file data provided for music file ${i + 1}`);
                        throw new Error(`No file data provided for music file ${i + 1}`);
                    }
                    
                    musicFilePaths.push(filePath);
                }
                console.log('Step 7: Music files processed successfully');
            }

            console.log('Step 8: Building FFmpeg command');
            // Create output file path
            const outputFileName = `reel_${Date.now()}.mp4`;
            const outputPath = path.join(tempDir, outputFileName);
            console.log('Output path:', outputPath);

            // Enforce 9:16 aspect ratio for output and images
            options.width = 1080;
            options.height = 1920;

            // Build FFmpeg command
            const ffmpegArgs = buildFFmpegCommand(mediaFilePaths, musicFilePaths, outputPath, options, logoTempPath, options.logoPosition, processedMediaFiles.map(f => f.duration), totalDuration);
            
            console.log('FFmpeg command:', ffmpegArgs.join(' '));

            console.log('Step 9: Executing FFmpeg command');
            // Execute FFmpeg command
            const result = await executeFFmpeg(ffmpegArgs);
            
            if (!result.success) {
                console.error('FFmpeg failed:', result.error);
                console.error('FFmpeg stderr:', result.stderr);
                console.error('FFmpeg stdout:', result.stdout);
                throw new Error(`FFmpeg failed: ${result.error}`);
            }

            console.log('Step 9: FFmpeg execution completed successfully');

            console.log('Video merge completed successfully');

            console.log('Step 10: Validating output file');
            // Check if output file exists
            try {
                await fs.access(outputPath);
                console.log('Output file exists and is accessible');
            } catch (error) {
                console.error('Output file access error:', error);
                throw new Error(`Output file not found: ${outputPath}`);
            }

            console.log('Step 11: Reading output file');
            // Read the output file
            let outputBuffer;
            try {
                outputBuffer = await fs.readFile(outputPath);
                console.log('Output file size:', outputBuffer.length);
                if (outputBuffer.length === 0) {
                    console.error('Output file is empty');
                    throw new Error('Output file is empty');
                }
            } catch (error) {
                console.error('Error reading output file:', error);
                throw new Error(`Failed to read output file: ${error.message}`);
            }

            // Check for previewOnly flag
            if (options && options.previewOnly) {
                // Send video directly for browser preview
                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Content-Disposition', `inline; filename="${outputFileName}"`);
                return res.send(outputBuffer);
            }

            // If previewOnly is not set, return an error (since S3 upload is removed)
            return res.status(400).json({
                error: 'Saving to S3 is no longer supported. Please use preview mode.',
                message: 'This endpoint only supports direct browser preview.'
            });

        } catch (mergeError) {
            console.error('Error during video merge process:', mergeError);
            return res.status(500).json({
                error: "Merge failed",
                message: mergeError.message
            });
        } finally {
            // Clean up temporary files
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
                console.log('Temporary files cleaned up');
            } catch (cleanupError) {
                console.error('Error cleaning up temporary files:', cleanupError);
            }
        }

    } catch (error) {
        console.error('Unexpected error in mergeVideos:', error);
        res.status(500).json({
            error: "Unexpected error",
            message: error.message
        });
    }
};

// Build FFmpeg command based on options
const buildFFmpegCommand = (mediaFilePaths, musicFilePaths, outputPath, options = {}, logoTempPath = null, logoPosition = 'top-right', mediaDurations = [], totalDuration = 14) => {
    const args = ['-y']; // Overwrite output file

    // Find outrow index (if present)
    const outrowIndex = mediaFilePaths.findIndex(p => p.includes('outrow.png'));
    const hasOutrow = outrowIndex !== -1;
    const mainPartCount = hasOutrow ? outrowIndex : mediaFilePaths.length;

    // Input files with duration for images
    mediaFilePaths.forEach((filePath, index) => {
        let duration = (mediaDurations && mediaDurations[index]) ? mediaDurations[index] : 2;
        args.push('-loop', '1', '-t', duration.toString(), '-i', filePath);
    });

    // Add logo as an input if present (for main part only)
    if (logoTempPath && mainPartCount > 0) {
        args.push('-i', logoTempPath);
    }

    // Music files (trim to totalDuration)
    musicFilePaths.forEach(filePath => {
        args.push('-t', totalDuration.toString(), '-i', filePath);
    });

    // Filter complex for video processing
    const filterComplex = [];
    const videoFilters = [];
    // 1. Scale and pad all images
    for (let i = 0; i < mediaFilePaths.length; i++) {
        videoFilters.push(
            `[${i}:v]scale=${options.width || 1080}:${options.height || 1920},setsar=1[v${i}]`
        );
    }

    // 2. Concatenate main part (with logo) and outrow (no logo)
    let concatInputs = [];
    let concatCount = 0;
    let overlayOutput = '';
    if (mainPartCount > 0) {
        // Concatenate main part
        const mainInputs = Array.from({length: mainPartCount}, (_, i) => `[v${i}]`).join('');
        videoFilters.push(`${mainInputs}concat=n=${mainPartCount}:v=1:a=0[maincatv]`);
        // Overlay logo on maincatv
        if (logoTempPath) {
            const logoInputIndex = mediaFilePaths.length; // after all media inputs
            // Scale logo to quarter size (half of current half-size)
            videoFilters.push(`[${logoInputIndex}:v]scale=iw/4:ih/4[logo_scaled]`);
            // Positioning
            let overlayPos = 'main_w-overlay_w-20:20'; // top-right default
            if (logoPosition === 'top-left') overlayPos = '20:20';
            videoFilters.push(`[maincatv][logo_scaled]overlay=${overlayPos}:format=auto[mainlogo]`);
            concatInputs.push('[mainlogo]');
        } else {
            concatInputs.push('[maincatv]');
        }
        concatCount++;
    }
    if (hasOutrow) {
        // outrow is the last image
        videoFilters.push(`[v${outrowIndex}]copy[outrowv]`);
        concatInputs.push('[outrowv]');
        concatCount++;
    }
    // Final concat if needed
    if (concatCount > 1) {
        videoFilters.push(`${concatInputs.join('')}concat=n=${concatCount}:v=1:a=0[outv]`);
        overlayOutput = '[outv]';
    } else {
        overlayOutput = concatInputs[0];
    }

    // Audio processing
    if (musicFilePaths.length > 0) {
        const audioFilters = [];
        musicFilePaths.forEach((_, index) => {
            const musicIndex = mediaFilePaths.length + (logoTempPath && mainPartCount > 0 ? 1 : 0) + index;
            audioFilters.push(`[${musicIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${index}]`);
        });

        if (audioFilters.length > 1) {
            const audioInputs = audioFilters.map((_, index) => `[a${index}]`).join('');
            audioFilters.push(`${audioInputs}amix=inputs=${musicFilePaths.length}:duration=longest[outa]`);
        } else {
            audioFilters.push(`[a0]anull[outa]`);
        }

        filterComplex.push(...videoFilters, ...audioFilters);
        args.push('-filter_complex', filterComplex.join(';'));
        args.push('-map', overlayOutput, '-map', '[outa]');
    } else {
        filterComplex.push(...videoFilters);
        args.push('-filter_complex', filterComplex.join(';'));
        args.push('-map', overlayOutput);
    }

    // Output settings
    // Add '-bf 0' to disable B-frames, so only I and P frames are used in the output video.
    args.push(
        '-c:v', 'libx264',
        '-bf', '0', // Disable B-frames: only I and P frames will be used
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'baseline',
        '-level', '3.0',
        '-preset', 'fast',
        '-crf', '28',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath
    );

    return args;
};

// Execute FFmpeg command
const executeFFmpeg = (args) => {
    return new Promise((resolve) => {
        console.log('Starting FFmpeg process with args:', args);
        
        const ffmpegProcess = spawn(ffmpegStatic, args);
        
        let stdout = '';
        let stderr = '';
        let progress = '';

        ffmpegProcess.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            console.log('FFmpeg stdout:', output);
        });

        ffmpegProcess.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            console.log('FFmpeg stderr:', output);
            
            // Extract progress information
            const progressMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
            if (progressMatch) {
                const hours = parseInt(progressMatch[1]);
                const minutes = parseInt(progressMatch[2]);
                const seconds = parseInt(progressMatch[3]);
                const centiseconds = parseInt(progressMatch[4]);
                const totalSeconds = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
                progress = `${totalSeconds.toFixed(2)}s`;
                console.log(`FFmpeg progress: ${progress}`);
            }
        });

        ffmpegProcess.on('close', (code) => {
            console.log(`FFmpeg process exited with code: ${code}`);
            if (code === 0) {
                console.log('FFmpeg completed successfully');
                resolve({
                    success: true,
                    stdout,
                    stderr,
                    progress
                });
            } else {
                console.error('FFmpeg failed with error:', stderr);
                resolve({
                    success: false,
                    error: stderr || `FFmpeg process exited with code ${code}`,
                    stdout,
                    stderr
                });
            }
        });

        ffmpegProcess.on('error', (error) => {
            console.error('FFmpeg process error:', error);
            resolve({
                success: false,
                error: error.message,
                stdout,
                stderr
            });
        });
    });
};

module.exports = {
    mergeVideos,
    testFFmpeg,
    testEndpoint
}; 