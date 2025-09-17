require('dotenv').config();
const axios = require('axios');

const generateImage = async (req, res) => {
    const { prompt, style = 'realistic', aspect_ratio = '9:16', seed = '5' } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ 
            error: 'prompt is required.' 
        });
    }

    try {
        // Seedream v4 via Comet API: request a generated image URL, then fetch the image bytes
        const apiUrl = 'https://api.cometapi.com/v1/images/generations';
        const apiKey = process.env.SEEDREAM_API_KEY || process.env.IMAGINEART_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ error: 'Seedream API key is not configured. Set SEEDREAM_API_KEY.' });
        }

        const payload = {
            model: 'bytedance-seedream-4-0-250828',
            prompt: prompt,
            // Best-effort mapping of inputs to upstream API fields
            ratio: aspect_ratio, // if unsupported, backend will ignore
            seed: String(seed),
            size: '2K',
            response_format: 'url',
            enable_sync_mode: true,
            watermark: false
        };

        const headers = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        };

        const genResponse = await axios.post(apiUrl, payload, {
            headers,
            timeout: 900000
        });

        const imageUrl = genResponse?.data?.items?.[0];
        if (!imageUrl) {
            return res.status(502).json({ error: 'Seedream did not return an image URL' });
        }

        // Fetch the image URL as binary and convert to base64 to preserve existing response shape
        const imageResp = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 900000
        });

        const base64Image = Buffer.from(imageResp.data).toString('base64');

        res.json({
            success: true,
            image: base64Image,
            prompt: prompt,
            style: style,
            aspect_ratio: aspect_ratio,
            seed: seed
        });

    } catch (error) {
        console.error('Generate image error:', error);
        if (error.response) {
            const status = error.response.status;
            const statusText = error.response.statusText;
            const details = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
            console.error('Seedream API Error:', details);
            return res.status(status).json({ 
                error: `Failed to generate image: ${status} ${statusText}` 
            });
        }
        res.status(500).json({ 
            error: error.message || 'Failed to generate image' 
        });
    }
};

module.exports = { generateImage };
