const { createClient } = require('@deepgram/sdk');

// POST { audio: <base64 string> }
const getSrtFromAudio = async (req, res) => {
  try {
    console.log('Starting SRT generation...');
    
    const audioBase64 = req.body.audio;
    if (!audioBase64) {
      console.error('No audio data provided');
      return res.status(400).json({ error: 'Audio file (base64) is required' });
    }

    // Validate API key
    if (!process.env.DEEPGRAM_API_KEY) {
      console.error('Deepgram API key not found');
      return res.status(500).json({ error: 'Deepgram API key not configured' });
    }

    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
    
    // Remove data URL prefix if present (data:audio/mp3;base64,)
    const base64Data = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
    const audioBuffer = Buffer.from(base64Data, 'base64');
    
    console.log(`Audio buffer size: ${audioBuffer.length} bytes`);

    // Enhanced transcription options for better sentence detection
    const transcriptionOptions = {
      model: 'nova-2',
      language: 'hi',
      smart_format: true,
      utterances: true,
      punctuate: true,
      diarize: false,
      timestamps: true,
      paragraphs: true // This helps with better sentence structure
    };

    console.log('Sending to Deepgram for transcription...');
    
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      audioBuffer,
      {
        mimetype: 'audio/mp3',
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
    
    // Convert to SRT format with sentence-based captions
    const srtContent = convertToSRT(result);
    
    if (!srtContent || srtContent.trim().length === 0) {
      console.error('Failed to generate SRT content');
      return res.status(500).json({ error: 'Failed to generate SRT captions' });
    }

    console.log('SRT generation successful');
    
    // Return SRT as plain text
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="captions.srt"');
    res.send(srtContent);

  } catch (err) {
    console.error('Controller error:', err);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: err.message 
    });
  }
};

// Helper function to convert Deepgram result to SRT format with sentence-based captions
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
    
    // Group words into sentences based on punctuation
    const sentences = groupWordsIntoSentences(allWords);
    
    // Generate SRT with sentence-based captions
    let srtContent = '';
    let captionIndex = 1;
    
    for (const sentence of sentences) {
      if (sentence.words.length === 0) continue;
      
      const startTime = sentence.words[0].start;
      const endTime = sentence.words[sentence.words.length - 1].end;
      const captionText = sentence.text.trim();
      
      if (captionText) {
        srtContent += `${captionIndex}\n`;
        srtContent += `${formatTime(startTime)} --> ${formatTime(endTime)}\n`;
        srtContent += `${captionText}\n\n`;
        captionIndex++;
      }
    }
    
    console.log(`Generated SRT with ${captionIndex - 1} sentence-based captions`);
    return srtContent;
  } catch (error) {
    console.error('Error converting to SRT:', error);
    return '';
  }
}

// Helper function to group words into sentences based on punctuation
function groupWordsIntoSentences(words) {
  const sentences = [];
  let currentSentence = { words: [], text: '' };
  
  // Sentence ending punctuation marks
  const sentenceEnders = /[.!?]/;
  
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const punctuatedWord = word.punctuated_word || word.word;
    
    currentSentence.words.push(word);
    currentSentence.text += (currentSentence.text ? ' ' : '') + punctuatedWord;
    
    // Check if this word ends a sentence
    if (sentenceEnders.test(punctuatedWord)) {
      // Check if it's not an abbreviation (simple check for common cases)
      const isAbbreviation = /\b[A-Z][a-z]?\.$/.test(punctuatedWord) && 
                            i < words.length - 1 && 
                            !/^[A-Z]/.test(words[i + 1].punctuated_word || words[i + 1].word);
      
      if (!isAbbreviation) {
        sentences.push({ ...currentSentence });
        currentSentence = { words: [], text: '' };
        continue;
      }
    }
    
    // Also split on long pauses (if there's a significant gap between words)
    if (i < words.length - 1) {
      const currentEndTime = word.end;
      const nextStartTime = words[i + 1].start;
      const gap = nextStartTime - currentEndTime;
      
      // If there's a pause longer than 2 seconds, treat it as sentence boundary
      if (gap > 2.0 && currentSentence.words.length > 0) {
        sentences.push({ ...currentSentence });
        currentSentence = { words: [], text: '' };
      }
    }
  }
  
  // Add any remaining words as the last sentence
  if (currentSentence.words.length > 0) {
    sentences.push(currentSentence);
  }
  
  // Post-process: merge very short sentences (less than 3 words) with adjacent ones
  const mergedSentences = [];
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    
    if (sentence.words.length < 3 && mergedSentences.length > 0) {
      // Merge with previous sentence
      const prevSentence = mergedSentences[mergedSentences.length - 1];
      prevSentence.words = [...prevSentence.words, ...sentence.words];
      prevSentence.text = prevSentence.text + ' ' + sentence.text;
    } else if (sentence.words.length < 3 && i < sentences.length - 1) {
      // Merge with next sentence
      const nextSentence = sentences[i + 1];
      nextSentence.words = [...sentence.words, ...nextSentence.words];
      nextSentence.text = sentence.text + ' ' + nextSentence.text;
      // Skip the current sentence and continue with the merged one
    } else {
      mergedSentences.push(sentence);
    }
  }
  
  return mergedSentences.length > 0 ? mergedSentences : sentences;
}

// Helper function to format time in SRT format (HH:MM:SS,mmm)
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
}

module.exports = { getSrtFromAudio };