require('dotenv').config();
const { createClient } = require('@deepgram/sdk');

const generateSRT = async (req, res) => {
    try {
        const { audio } = req.body;
        
        if (!audio) {
            return res.status(400).json({ error: 'Audio data is required.' });
        }

        // Validate API key
        if (!process.env.DEEPGRAM_API_KEY) {
            console.error('Deepgram API key not found');
            return res.status(500).json({ error: 'Deepgram API key not configured' });
        }

        const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
        
        // Remove data URL prefix if present (data:audio/mp3;base64,)
        const base64Data = audio.replace(/^data:audio\/[^;]+;base64,/, '');
        const audioBuffer = Buffer.from(base64Data, 'base64');
        
        console.log(`Audio buffer size: ${audioBuffer.length} bytes`);

        // Enhanced transcription options
        const transcriptionOptions = {
            model: 'nova-2',
            language: 'hi',
            smart_format: true,
            utterances: true,
            punctuate: true,
            diarize: false, // Set to true if you want speaker separation
            timestamps: true
        };

        console.log('Sending to Deepgram for transcription...');
        
        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            audioBuffer,
            {
                mimetype: 'audio/mp3', // You might need to detect this dynamically
                ...transcriptionOptions
            }
        );

        if (error) {
            console.error('Deepgram API error:', error);
            return res.status(500).json({ 
                error: 'Transcription failed', 
                details: error.message || error 
            });
        }

        if (!result) {
            console.error('No result returned from Deepgram');
            return res.status(500).json({ error: 'No transcription result received' });
        }

        console.log('Transcription successful, converting to SRT...');
        
        // Convert to SRT format
        const srtContent = convertToSRT(result);
        
        if (!srtContent || srtContent.trim().length === 0) {
            console.error('Failed to generate SRT content');
            return res.status(500).json({ error: 'Failed to generate SRT captions' });
        }

        console.log('SRT generation successful');
        
        res.json({ srt: srtContent });

    } catch (err) {
        console.error('Controller error:', err);
        res.status(500).json({ 
            error: 'Internal server error', 
            details: err.message 
        });
    }
};

// Helper function to convert Deepgram result to SRT format
function convertToSRT(result) {
    try {
        // Get all words from the transcription
        let allWords = [];
        
        if (result.results && result.results.channels && result.results.channels[0] && result.results.channels[0].alternatives) {
            const alternative = result.results.channels[0].alternatives[0];
            if (alternative && alternative.words && alternative.words.length > 0) {
                allWords = alternative.words;
            }
        }
        
        if (allWords.length === 0) {
            console.warn('No words found in transcription result');
            return '';
        }

        console.log(`Total words found: ${allWords.length}`);
        
        // Generate SRT with 3 words at a time
        let srtContent = '';
        let captionIndex = 1;
        const wordsPerCaption = 3;
        
        for (let i = 0; i < allWords.length; i += wordsPerCaption) {
            const wordGroup = allWords.slice(i, i + wordsPerCaption);
            
            if (wordGroup.length === 0) continue;
            
            const startTime = wordGroup[0].start;
            const endTime = wordGroup[wordGroup.length - 1].end;
            const captionText = wordGroup.map(word => word.punctuated_word || word.word).join(' ');
            
            if (captionText.trim()) {
                srtContent += `${captionIndex}\n`;
                srtContent += `${formatTime(startTime)} --> ${formatTime(endTime)}\n`;
                srtContent += `${captionText.trim()}\n\n`;
                captionIndex++;
            }
        }
        
        console.log(`Generated SRT with ${captionIndex - 1} captions (4 words each)`);
        return srtContent;
    } catch (error) {
        console.error('Error converting to SRT:', error);
        return '';
    }
}

// Helper function to format time in SRT format (HH:MM:SS,mmm)
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
}

module.exports = { generateSRT };
