const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const axios = require('axios');
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { s3, BUCKET_NAME } = require("../config/s3");
const Datastore = require("../models/datastore");

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

// Merge videos using FFmpeg
const mergeVideos = async (req, res) => {
    try {
        const {
            mediaFiles,
            musicFiles,
            options,
            folder,
            userId,
            title,
            description
        } = req.body;

        if (!mediaFiles || mediaFiles.length === 0) {
            return res.status(400).json({
                error: "No media files provided",
                message: "Please provide at least one media file"
            });
        }

        if (!folder || !userId) {
            return res.status(400).json({
                error: "Missing required information",
                message: "Please provide folder and user information"
            });
        }

        console.log('Starting video merge process...');
        console.log('Media files:', mediaFiles.length);
        console.log('Music files:', musicFiles ? musicFiles.length : 0);
        console.log('Options:', options);

        // Create temporary directory
        const tempDir = path.join(os.tmpdir(), `video-merge-${Date.now()}`);
        await fs.mkdir(tempDir, { recursive: true });

        try {
            // Download all media files
            const mediaFilePaths = [];
            for (let i = 0; i < mediaFiles.length; i++) {
                const mediaFile = mediaFiles[i];
                
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
                
                console.log(`Downloading media file ${i + 1}/${mediaFiles.length}: ${fileName}`);
                const response = await axios.get(mediaFile.fileUrl, { responseType: 'arraybuffer' });
                await fs.writeFile(filePath, response.data);
                mediaFilePaths.push(filePath);
            }

            // Download music files if provided
            const musicFilePaths = [];
            if (musicFiles && musicFiles.length > 0) {
                for (let i = 0; i < musicFiles.length; i++) {
                    const musicFile = musicFiles[i];
                    
                    // Validate fileName and provide fallback
                    let fileName = musicFile.fileName;
                    if (!fileName) {
                        // Try to extract filename from URL
                        try {
                            const url = new URL(musicFile.fileUrl);
                            fileName = url.pathname.split('/').pop() || `music_${i}`;
                        } catch (e) {
                            fileName = `music_${i}`;
                        }
                    }
                    
                    // Get file extension with fallback
                    let extension = '';
                    try {
                        extension = path.extname(fileName);
                        if (!extension) {
                            // Default to common audio extensions
                            if (musicFile.mimeType && musicFile.mimeType.includes('audio')) {
                                extension = '.mp3';
                            } else {
                                extension = '.mp3'; // Default fallback
                            }
                        }
                    } catch (e) {
                        extension = '.mp3'; // Default fallback
                    }
                    
                    const filePath = path.join(tempDir, `music_${i}${extension}`);
                    
                    console.log(`Downloading music file ${i + 1}/${musicFiles.length}: ${fileName}`);
                    const response = await axios.get(musicFile.fileUrl, { responseType: 'arraybuffer' });
                    await fs.writeFile(filePath, response.data);
                    musicFilePaths.push(filePath);
                }
            }

            // Create output file path
            const outputFileName = `reel_${Date.now()}.mp4`;
            const outputPath = path.join(tempDir, outputFileName);

            // Build FFmpeg command
            const ffmpegArgs = buildFFmpegCommand(mediaFilePaths, musicFilePaths, outputPath, options);
            
            console.log('FFmpeg command:', ffmpegArgs.join(' '));

            // Execute FFmpeg command
            const result = await executeFFmpeg(ffmpegArgs);
            
            if (!result.success) {
                throw new Error(`FFmpeg failed: ${result.error}`);
            }

            console.log('Video merge completed successfully');

            // Read the output file
            const outputBuffer = await fs.readFile(outputPath);

            // Upload to S3
            const s3Key = `${userId}/${folder.categoryId}/${folder.subcategoryId ? folder.subcategoryId + '/' : ''}${folder.id}/${outputFileName}`;
            
            const uploadCommand = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: s3Key,
                Body: outputBuffer,
                ContentType: 'video/mp4',
                ACL: 'private',
                Metadata: {
                    title: title || outputFileName,
                    description: description || '',
                    userId: userId,
                    categoryId: folder.categoryId,
                    subcategoryId: folder.subcategoryId || '',
                    folderId: folder.id,
                    originalFiles: mediaFiles.length.toString(),
                    musicFiles: musicFiles ? musicFiles.length.toString() : '0'
                }
            });

            await s3.send(uploadCommand);

            // Create datastore entry
            const datastoreData = {
                type: 'Video',
                title: title || outputFileName,
                description: description || '',
                fileUrl: `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Key}`,
                fileName: outputFileName,
                fileSize: outputBuffer.length,
                mimeType: 'video/mp4',
                metadata: {
                    userId,
                    categoryId: folder.categoryId,
                    subcategoryId: folder.subcategoryId || null,
                    folderId: folder.id,
                    key: s3Key,
                    mimeType: 'video/mp4',
                    originalFiles: mediaFiles.length,
                    musicFiles: musicFiles ? musicFiles.length : 0,
                    options: options
                }
            };

            const datastore = await Datastore.create(datastoreData);

            // Get signed URL for immediate access
            const getObjectCommand = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: s3Key
            });

            const signedUrl = await getSignedUrl(s3, getObjectCommand, {
                expiresIn: 3600
            });

            res.json({
                success: true,
                message: "Video merged successfully",
                fileId: datastore._id,
                fileUrl: datastore.fileUrl,
                signedUrl: signedUrl,
                fileName: outputFileName,
                fileSize: outputBuffer.length
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
        console.error('Video merge error:', error);
        res.status(500).json({
            error: "Failed to merge videos",
            message: error.message
        });
    }
};

// Build FFmpeg command based on options
const buildFFmpegCommand = (mediaFilePaths, musicFilePaths, outputPath, options = {}) => {
    const args = ['-y']; // Overwrite output file

    // Input files
    mediaFilePaths.forEach(filePath => {
        args.push('-i', filePath);
    });

    // Music files
    musicFilePaths.forEach(filePath => {
        args.push('-i', filePath);
    });

    // Filter complex for video processing
    const filterComplex = [];
    
    // Video scaling and formatting
    const videoFilters = [];
    mediaFilePaths.forEach((_, index) => {
        const videoFilter = `[${index}:v]scale=${options.width || 1080}:${options.height || 1920}:force_original_aspect_ratio=decrease,pad=${options.width || 1080}:${options.height || 1920}:(ow-iw)/2:(oh-ih)/2:black[v${index}]`;
        videoFilters.push(videoFilter);
    });

    // Concatenate videos
    if (mediaFilePaths.length > 1) {
        const videoInputs = mediaFilePaths.map((_, index) => `[v${index}]`).join('');
        videoFilters.push(`${videoInputs}concat=n=${mediaFilePaths.length}:v=1:a=0[outv]`);
    } else {
        videoFilters.push(`[v0]copy[outv]`);
    }

    // Audio processing
    if (musicFilePaths.length > 0) {
        const audioFilters = [];
        musicFilePaths.forEach((_, index) => {
            const musicIndex = mediaFilePaths.length + index;
            audioFilters.push(`[${musicIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${index}]`);
        });

        if (audioFilters.length > 1) {
            const audioInputs = audioFilters.map((_, index) => `[a${index}]`).join('');
            audioFilters.push(`${audioInputs}amix=inputs=${musicFilePaths.length}:duration=longest[outa]`);
        } else {
            audioFilters.push(`[a0]copy[outa]`);
        }

        filterComplex.push(...videoFilters, ...audioFilters);
        args.push('-filter_complex', filterComplex.join(';'));
        args.push('-map', '[outv]', '-map', '[outa]');
    } else {
        filterComplex.push(...videoFilters);
        args.push('-filter_complex', filterComplex.join(';'));
        args.push('-map', '[outv]');
    }

    // Output settings
    args.push(
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-metadata', `title=${options.title || 'Merged Video'}`,
        '-metadata', `description=${options.description || ''}`,
        '-metadata', `creation_time=${new Date().toISOString()}`,
        outputPath
    );

    return args;
};

// Execute FFmpeg command
const executeFFmpeg = (args) => {
    return new Promise((resolve) => {
        const ffmpegProcess = spawn(ffmpegStatic, args);
        
        let stdout = '';
        let stderr = '';
        let progress = '';

        ffmpegProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        ffmpegProcess.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            
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
            if (code === 0) {
                resolve({
                    success: true,
                    stdout,
                    stderr,
                    progress
                });
            } else {
                resolve({
                    success: false,
                    error: stderr || `FFmpeg process exited with code ${code}`,
                    stdout,
                    stderr
                });
            }
        });

        ffmpegProcess.on('error', (error) => {
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
    mergeVideos
}; 