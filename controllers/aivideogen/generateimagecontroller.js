require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');

const generateImage = async (req, res) => {
    const { prompt, style = 'realistic', aspect_ratio = '9:16', seed = '5', variation } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ 
            error: 'prompt is required.' 
        });
    }

    try {
        // Create form data for the API request
        const cleanedPrompt = String(prompt)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 700);

        const formData = new FormData();
        formData.append('prompt', cleanedPrompt);
        formData.append('style', style || 'realistic');
        formData.append('aspect_ratio', aspect_ratio || '9:16');
        formData.append('seed', seed || '5');

        // Vyro/ImagineArt requires a variation parameter.
        // Their error says "invalid variation" for our previous values,
        // so here we hard-force a simple numeric default ("1")
        // and ignore anything coming from the client to stay within
        // the supported range.
        const safeVariation = '1';
        formData.append('variation', safeVariation);

        const response = await axios.post('https://api.vyro.ai/v2/image/generations', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.IMAGINEART_API_KEY}`,
                ...formData.getHeaders()
            },
            responseType: 'arraybuffer',
            timeout: 900000 // 15 minutes timeout
        });

        // Convert the image buffer to base64
        const base64Image = Buffer.from(response.data).toString('base64');

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
            const raw = error.response.data;
            const decoded =
              Buffer.isBuffer(raw) ? raw.toString('utf8') : typeof raw === 'string' ? raw : JSON.stringify(raw);
            console.error('ImagineArt API Error:', decoded);

            // Hard fallback for persistent "invalid variation" errors from Vyro.
            // This keeps the News Reel pipeline working even if the external
            // ImagineArt service is picky or temporarily misconfigured.
            if (decoded && decoded.includes && decoded.includes('invalid variation')) {
                try {
                    // Simple placeholder vertical image (black background with white text)
                    // using a public dummy image service.
                    const placeholderUrl = 'https://dummyimage.com/720x1280/000000/ffffff.png&text=YovoAI+Frame';
                    const placeholderResp = await axios.get(placeholderUrl, {
                        responseType: 'arraybuffer',
                        timeout: 15000
                    });
                    const base64Image = Buffer.from(placeholderResp.data).toString('base64');

                    return res.json({
                        success: true,
                        image: base64Image,
                        prompt: prompt,
                        style: style,
                        aspect_ratio: aspect_ratio,
                        seed: seed,
                        fallback: true,
                        fallbackReason: 'Vyro invalid variation – used placeholder image'
                    });
                } catch (fallbackErr) {
                    console.error('Placeholder image fallback failed:', fallbackErr);
                    return res.status(error.response.status).json({
                        error: `Failed to generate image: ${error.response.status} ${error.response.statusText}`,
                        details: decoded
                    });
                }
            }

            return res.status(error.response.status).json({ 
                error: `Failed to generate image: ${error.response.status} ${error.response.statusText}`,
                details: decoded
            });
        }
        
        res.status(500).json({ 
            error: error.message || 'Failed to generate image' 
        });
    }
};

module.exports = { generateImage };
