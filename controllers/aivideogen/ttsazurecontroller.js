require('dotenv').config();
const axios = require('axios');

// Azure TTS (Cognitive Services) -> returns base64 MP3
// Env supported:
// - AZURE_Voice_API_KEY
// - AZURE_Voice_ENDPOINT (e.g. https://xxxx.cognitiveservices.azure.com/)
// Optional:
// - AZURE_Voice_DefaultVoice (e.g. en-US-JennyNeural)
//
// Request body:
// { text: string, voiceName?: string, format?: 'base64' | 'file' }
//
// Response:
// { success: true, audio: <base64 mp3>, format: 'mp3', voiceName }

const textToSpeechAzure = async (req, res) => {
  try {
    const { text, voiceName, format = 'base64' } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({ success: false, error: 'Text is required for text-to-speech.' });
    }

    const key = process.env.AZURE_Voice_API_KEY?.trim();
    const endpointRaw = process.env.AZURE_Voice_ENDPOINT?.trim();
    const defaultVoice = process.env.AZURE_Voice_DefaultVoice?.trim() || 'en-US-JennyNeural';

    if (!key || !endpointRaw) {
      return res.status(500).json({
        success: false,
        error: 'Azure Voice API is not configured (missing AZURE_Voice_API_KEY or AZURE_Voice_ENDPOINT).'
      });
    }

    // Normalize endpoint:
    // - Speech TTS endpoints typically look like: https://<region>.tts.speech.microsoft.com/
    // - Some users paste generic region endpoints like: https://eastus.api.cognitive.microsoft.com/
    //   Those are NOT TTS endpoints, so we convert them to the correct TTS host.
    let endpoint = endpointRaw.replace(/\/+$/, '');
    try {
      const u = new URL(endpoint);
      if (u.hostname.endsWith('.api.cognitive.microsoft.com')) {
        const region = u.hostname.split('.')[0]; // eastus, westeurope, etc.
        endpoint = `https://${region}.tts.speech.microsoft.com`;
      }
    } catch (_) {
      // keep as-is
    }

    const url = endpoint + '/cognitiveservices/v1';
    const v = (voiceName && String(voiceName).trim()) || defaultVoice;

    // Basic SSML
    const escaped = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const ssml =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
      `<voice name="${v}">${escaped}</voice>` +
      `</speak>`;

    const resp = await axios.post(url, ssml, {
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        // MP3 output
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'yovoai-tts'
      },
      responseType: 'arraybuffer',
      timeout: 60000
    });

    const audioBuffer = Buffer.from(resp.data);

    if (format === 'file') {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', 'attachment; filename="speech.mp3"');
      return res.send(audioBuffer);
    }

    return res.json({
      success: true,
      audio: audioBuffer.toString('base64'),
      format: 'mp3',
      voiceName: v
    });
  } catch (error) {
    const status = error?.response?.status;
    const detail = error?.response?.data
      ? Buffer.isBuffer(error.response.data)
        ? error.response.data.toString('utf8')
        : JSON.stringify(error.response.data)
      : undefined;

    console.error('[AzureTTS] Error:', status || '', error?.message || error, detail || '');

    return res.status(500).json({
      success: false,
      error: 'Failed to convert text to speech (Azure). Please try again.',
      details: status ? `Azure status ${status}` : undefined,
      hint: 'Make sure AZURE_Voice_ENDPOINT points to Speech TTS. Example: https://eastus.tts.speech.microsoft.com/'
    });
  }
};

module.exports = { textToSpeechAzure };

