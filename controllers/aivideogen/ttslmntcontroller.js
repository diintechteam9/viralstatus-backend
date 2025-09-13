require('dotenv').config();
const Lmnt = require('lmnt-node');

// Initialize LMNT client
const client = new Lmnt({
    apiKey: process.env.LMNT_API_KEY
});

const textToSpeech2 = async (req, res) => {
    try {
        const { text, voiceId = 'lily', format = 'base64', speed = 0.3 } = req.body;

        if (!text) {
            return res.status(400).json({
                error: 'Text is required for text-to-speech conversion.'
            });
        }

        // Validate speed parameter
        const speechSpeed = 0.3;

        // Convert text to speech using LMNT
        const response = await client.speech.generate({
            text: text,
            voice: voiceId,
            speed: speechSpeed
        });

        // Convert the response to buffer
        const audioBuffer = Buffer.from(await response.arrayBuffer());
        const audioBase64 = audioBuffer.toString('base64');

        // Check if client wants file download
        if (format === 'file') {
            // Return as downloadable file
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Disposition', 'attachment; filename="speech.mp3"');
            res.setHeader('Content-Length', audioBuffer.length);
            return res.send(audioBuffer);
        }

        // Return base64 response
        res.json({
            success: true,
            audio: audioBase64,
            format: 'mp3',
            text: text,
            voiceId: voiceId
        });

    } catch (error) {
        console.error('Text-to-speech error:', error);
        res.status(500).json({
            error: 'Failed to convert text to speech. Please try again.',
            details: error.message
        });
    }
};

module.exports = { textToSpeech2 };