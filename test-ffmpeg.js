const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

console.log('FFmpeg path:', ffmpegStatic);
console.log('FFmpeg version:');

// Test FFmpeg version
ffmpeg.getAvailableCodecs((err, codecs) => {
    if (err) {
        console.error('Error getting codecs:', err);
    } else {
        console.log('FFmpeg is working correctly!');
        console.log('Available codecs count:', Object.keys(codecs).length);
    }
});

// Test FFmpeg version
ffmpeg.getAvailableFormats((err, formats) => {
    if (err) {
        console.error('Error getting formats:', err);
    } else {
        console.log('Available formats count:', Object.keys(formats).length);
    }
}); 