require('dotenv').config();

const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');

const elevenlabs = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY
});

const textToSpeech1 = async (req, res) => {
    try {
        const { text, voiceId = 'JBFqnCBsd6RMkjVDRZzb', format = 'base64' } = req.body;

        if (!text) {
            return res.status(400).json({
                error: 'Text is required for text-to-speech conversion.'
            });
        }

        // Convert text to speech using ElevenLabs
        const audio = await elevenlabs.textToSpeech.convert(voiceId, {
            text: text,
            modelId: 'eleven_multilingual_v2',
            outputFormat: 'mp3_44100_128',
        });

        // Convert the audio buffer to base64 for sending in response
        let audioBase64;
        let audioBuffer;
        
        if (audio instanceof ReadableStream) {
            // Convert ReadableStream to ArrayBuffer
            const reader = audio.getReader();
            const chunks = [];
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            
            // Combine chunks into a single Uint8Array
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const combinedArray = new Uint8Array(totalLength);
            let offset = 0;
            
            for (const chunk of chunks) {
                combinedArray.set(chunk, offset);
                offset += chunk.length;
            }
            
            // Convert to base64 and buffer
            audioBuffer = Buffer.from(combinedArray);
            audioBase64 = audioBuffer.toString('base64');
        } else if (audio instanceof ArrayBuffer) {
            audioBuffer = Buffer.from(audio);
            audioBase64 = audioBuffer.toString('base64');
        } else if (audio instanceof Buffer) {
            audioBuffer = audio;
            audioBase64 = audio.toString('base64');
        } else {
            // Fallback: try to convert directly
            audioBuffer = Buffer.from(audio);
            audioBase64 = audioBuffer.toString('base64');
        }

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

module.exports = { textToSpeech1 }; 