require('dotenv').config();

// NOTE: You may need to install the Sarvam SDK:
// npm install sarvamai
// or
// yarn add sarvamai

let SarvamAIClient;
try {
  // Prefer require to match CommonJS style of the codebase
  ({ SarvamAIClient } = require('sarvamai'));
} catch (e) {
  console.log('sarvamai package not installed. Please install it to enable Sarvam TTS.');
}

const sarvamClient = SarvamAIClient
  ? new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY })
  : null;

const textToSpeech3 = async (req, res) => {
  try {
    if (!sarvamClient) {
      return res.status(500).json({ error: 'Sarvam SDK not installed on server.' });
    }

    const {
      text,
      target_language_code = 'hi-IN',
      speaker = 'anushka',
      pitch = 0,
      pace = 1,
      loudness = 1,
      speech_sample_rate = 22050,
      enable_preprocessing = true,
      model = 'bulbul:v2',
      format = 'base64'
    } = req.body || {};

    if (!text || !text.toString().trim()) {
      return res.status(400).json({ error: 'Text is required for text-to-speech conversion.' });
    }

    const response = await sarvamClient.textToSpeech.convert({
      text: text.toString(),
      target_language_code,
      speaker,
      pitch,
      pace,
      loudness,
      speech_sample_rate,
      enable_preprocessing,
      model
    });

    // Attempt to normalize response to Buffer -> base64
    let audioBuffer;
    let audioBase64;

    if (!response) {
      throw new Error('Empty response from Sarvam API');
    }

    // Helper to strip data URL prefix
    const stripDataUrlPrefix = (value) => {
      if (typeof value !== 'string') return value;
      const idx = value.indexOf(',');
      if (value.startsWith('data:') && idx !== -1) {
        return value.slice(idx + 1);
      }
      return value;
    };

    // Case 1: Response-like object with arrayBuffer()
    if (typeof response.arrayBuffer === 'function') {
      const ab = await response.arrayBuffer();
      audioBuffer = Buffer.from(ab);
      audioBase64 = audioBuffer.toString('base64');
    }

    // Case 2: Direct Buffer/ArrayBuffer
    if (!audioBase64) {
      if (response instanceof Buffer) {
        audioBuffer = response;
        audioBase64 = response.toString('base64');
      } else if (response instanceof ArrayBuffer) {
        audioBuffer = Buffer.from(response);
        audioBase64 = audioBuffer.toString('base64');
      }
    }

    // Case 3: Common nested fields
    if (!audioBase64) {
      const candidates = [
        response.audio,
        response.audio_base64,
        response.audioBase64,
        response.audio_content,
        response.audioContent,
        response.output?.audio,
        response.data?.audio,
        response.result?.audio,
        response.result?.audio_base64,
        response.result?.audioContent,
      ];
      for (const candidate of candidates) {
        if (candidate instanceof Buffer) {
          audioBuffer = candidate;
          audioBase64 = candidate.toString('base64');
          break;
        }
        if (candidate instanceof ArrayBuffer) {
          audioBuffer = Buffer.from(candidate);
          audioBase64 = audioBuffer.toString('base64');
          break;
        }
        if (ArrayBuffer.isView(candidate)) {
          audioBuffer = Buffer.from(candidate.buffer);
          audioBase64 = audioBuffer.toString('base64');
          break;
        }
        if (typeof candidate === 'string' && candidate.length > 0) {
          const maybeBase64 = stripDataUrlPrefix(candidate);
          // Heuristic: if it looks like base64, accept
          try {
            audioBuffer = Buffer.from(maybeBase64, 'base64');
            if (audioBuffer && audioBuffer.length > 0) {
              audioBase64 = maybeBase64;
              break;
            }
          } catch {}
        }
      }
    }

    // Case 3b: Array of audios
    if (!audioBase64 && Array.isArray(response.audios)) {
      for (const item of response.audios) {
        const audioCandidates = [
          item,
          item?.audio,
          item?.audio_base64,
          item?.audioBase64,
          item?.audio_content,
          item?.audioContent,
          item?.data,
          item?.content,
          item?.buffer,
          item?.url,
        ];
        let found = false;
        for (const cand of audioCandidates) {
          if (cand instanceof Buffer) {
            audioBuffer = cand;
            audioBase64 = cand.toString('base64');
            found = true; break;
          }
          if (cand instanceof ArrayBuffer) {
            audioBuffer = Buffer.from(cand);
            audioBase64 = audioBuffer.toString('base64');
            found = true; break;
          }
          if (ArrayBuffer.isView(cand)) {
            audioBuffer = Buffer.from(cand.buffer);
            audioBase64 = audioBuffer.toString('base64');
            found = true; break;
          }
          if (typeof cand === 'string' && cand.length > 0) {
            const maybeBase64 = stripDataUrlPrefix(cand);
            try {
              const buf = Buffer.from(maybeBase64, 'base64');
              if (buf && buf.length > 0) {
                audioBuffer = buf;
                audioBase64 = maybeBase64;
                found = true; break;
              }
            } catch {}
            // If looks like URL
            if (!found && /^https?:\/\//i.test(cand)) {
              let fetchImpl;
              try { fetchImpl = require('node-fetch'); } catch (e) {}
              if (!fetchImpl) {
                return res.status(500).json({
                  error: 'Sarvam returned an audio URL. Please install node-fetch to fetch audio server-side.',
                  details: 'npm install node-fetch@2'
                });
              }
              const r = await fetchImpl(cand);
              if (!r.ok) throw new Error(`Failed to fetch Sarvam audio URL: ${r.status}`);
              const ab = await r.arrayBuffer();
              audioBuffer = Buffer.from(ab);
              audioBase64 = audioBuffer.toString('base64');
              found = true; break;
            }
          }
        }
        if (found) break;
      }
    }

    // Case 4: URL returned
    if (!audioBase64) {
      const urlCandidate = response.url || response.audioUrl || response.audio_url || response.output?.url;
      if (typeof urlCandidate === 'string' && /^https?:\/\//i.test(urlCandidate)) {
        let fetchImpl;
        try {
          fetchImpl = require('node-fetch');
        } catch (e) {
          return res.status(500).json({
            error: 'Sarvam returned a URL. Please install node-fetch to fetch audio server-side.',
            details: 'npm install node-fetch@2'
          });
        }
        const r = await fetchImpl(urlCandidate);
        if (!r.ok) throw new Error(`Failed to fetch Sarvam audio URL: ${r.status}`);
        const ab = await r.arrayBuffer();
        audioBuffer = Buffer.from(ab);
        audioBase64 = audioBuffer.toString('base64');
      }
    }

    if (!audioBase64) {
      // As a last resort, log keys to help debugging
      const keys = Object.keys(response || {});
      throw new Error(`Unable to parse audio from Sarvam response (keys: ${keys.join(', ')})`);
    }

    if (format === 'file') {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', 'attachment; filename="speech.mp3"');
      res.setHeader('Content-Length', audioBuffer.length);
      return res.send(audioBuffer);
    }

    return res.json({
      success: true,
      audio: audioBase64,
      format: 'mp3',
      text
    });
  } catch (error) {
    console.error('Sarvam text-to-speech error:', error);
    return res.status(500).json({
      error: 'Failed to convert text to speech with Sarvam.',
      details: error.message
    });
  }
};

module.exports = { textToSpeech3 };

