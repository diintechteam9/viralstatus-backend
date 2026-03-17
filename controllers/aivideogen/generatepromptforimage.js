require('dotenv').config();

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const generatePrompt = async (req, res) => {
    const { storyScript, imageSrt, deepSrt, srt } = req.body;
    
    if (!storyScript && !imageSrt && !deepSrt && !srt) {
        return res.status(400).json({ 
            error: 'Provide at least storyScript or Deepgram SRT (imageSrt/deepSrt/srt).' 
        });
    }

    try {
        // 1) Prefer Deepgram SRT for sentence segmentation to match video/image timing
        let sentences = [];
        const srtSource = imageSrt || deepSrt || srt;
        if (srtSource) {
            const entries = parseSRT(srtSource);
            const grouped = groupSRTIntoSentences(entries);
            sentences = grouped.map(g => (g.text || '').trim()).filter(Boolean);
        }

        // Fallback to story-based segmentation if no SRT provided
        if (sentences.length === 0 && storyScript) {
            sentences = splitIntoLogicalSentences(storyScript);
        }

        if (sentences.length === 0) {
            return res.status(400).json({ error: 'No valid sentences found from SRT or storyScript.' });
        }

        // 2) Ask AI for a consistent global visual style/context (use storyScript if available, else join sentences)
        const styleContext = storyScript || sentences.join(' ');
        const styleData = await getGlobalVisualStyle(styleContext);

            // 3) Ask AI to produce one coherent image prompt per sentence using the style
        let imagePrompts = await generatePromptsWithAI(sentences, styleData);

        // 4) Validate and fallback if needed
        const valid = Array.isArray(imagePrompts) && imagePrompts.length === sentences.length && imagePrompts.every(p => p && typeof p.prompt === 'string');
        if (!valid) {
            imagePrompts = createPromptsWithTemplate(sentences, styleData);
        }

        // 5) Number and include original sentence for traceability
        const numbered = imagePrompts.map((p, idx) => ({
            number: idx + 1,
            sentence: sentences[idx],
            prompt: p.prompt
        }));

        return res.json(numbered);
    } catch (err) {
        console.error('Generate image prompts error:', err);
        return res.status(500).json({ error: err.message || 'Failed to generate prompts' });
    }
};

function parseSRT(srtContent) {
    const entries = [];
    const blocks = String(srtContent).trim().split('\n\n');
    blocks.forEach(block => {
        const lines = block.split('\n');
        if (lines.length >= 2) {
            const timeLine = lines[1];
            const text = lines.slice(2).join(' ').trim();
            const timeMatch = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
            if (timeMatch) {
                const startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
                const endTime = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
                entries.push({ startTime, endTime, text });
            }
        }
    });
    return entries;
}

function groupSRTIntoSentences(entries) {
    const sentences = [];
    let current = null;
    entries.forEach((entry, idx) => {
        const text = (entry.text || '').trim();
        const endsSentence = /[.!?]$/.test(text);
        if (!current) {
            current = { startTime: entry.startTime, endTime: entry.endTime, text: text };
        } else {
            current.endTime = entry.endTime;
            if (text.length > 0) current.text += (current.text ? ' ' : '') + text;
        }
        if (endsSentence || idx === entries.length - 1) {
            // Merge tiny trailing pieces logically: ensure minimum words
            const minWords = 4;
            const wc = (current.text || '').split(/\s+/).filter(Boolean).length;
            if (wc < minWords && sentences.length > 0) {
                sentences[sentences.length - 1].endTime = current.endTime;
                sentences[sentences.length - 1].text = `${sentences[sentences.length - 1].text} ${current.text}`.trim();
            } else {
                sentences.push(current);
            }
            current = null;
        }
    });
    return sentences;
}

function splitIntoLogicalSentences(text) {
    const normalized = String(text).replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    const rawParts = normalized
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(Boolean);
    const merged = [];
    const minWords = 4;
    for (let i = 0; i < rawParts.length; i++) {
        const part = rawParts[i];
        const wordCount = part.split(/\s+/).filter(Boolean).length;
        if (wordCount < minWords && merged.length > 0) {
            merged[merged.length - 1] = `${merged[merged.length - 1]} ${part}`.trim();
        } else {
            merged.push(part);
        }
    }
    return merged.map(s => /[.!?]$/.test(s) ? s : `${s}.`);
}

async function getGlobalVisualStyle(storyContext) {
    try {
        const body = {
            model: 'anthropic/claude-3-haiku',
            messages: [
                {
                    role: 'user',
                    content: `Analyze the story/context and propose a single consistent visual style used across all images. Return STRICT JSON with keys: style, palette, mood, camera, characters (array with name and appearance), environment.\n\nContext: """${storyContext}"""\n\nReturn JSON only, no extra text.`
                }
            ],
            max_tokens: 800,
            temperature: 0.5
        };
        const resp = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error(`OpenRouter style call failed: ${resp.status}`);
        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content?.trim() || '{}';
        try {
            return JSON.parse(content);
        } catch (e) {
            return {};
        }
    } catch (e) {
        // OpenRouter may return 402 (payment required). In that case, silently fallback.
        const msg = String(e?.message || '');
        if (!msg.includes('402')) {
            console.warn('Style generation failed, using defaults:', e.message);
        }
        return {};
    }
}

async function generatePromptsWithAI(sentences, styleData) {
    try {
        const styleSnippet = JSON.stringify(styleData || {});
        const numberedSentences = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
        const body = {
            model: 'anthropic/claude-3-haiku',
            messages: [
                {
                    role: 'user',
                    content: `You are generating coherent, sequential image prompts for a video.\n\nGLOBAL CONSTRAINTS (apply to ALL prompts):\n- Maintain strong visual consistency using this style info: ${styleSnippet}\n- Reuse the SAME characters (names, clothing, appearance) across prompts.\n- Keep the SAME environment and color palette unless the sentence clearly changes it.\n- Ensure narrative continuity: each prompt (n) should logically follow prompt (n-1).\n- Avoid contradictions with earlier prompts.\n\nTASK:\n- For EACH sentence below, produce ONE detailed visual image prompt depicting the scene. Include characters, environment, lighting, mood, camera hints; educational, clean, colorful digital art.\n- Return STRICT JSON: { \\\"imagePrompts\\\": [ {\\\"prompt\\\": \\\"...\\\"}, ... ] }\n- The array length MUST equal the number of sentences.\n\nSentences:\n${numberedSentences}`
                }
            ],
            max_tokens: 3000,
            temperature: 0.6
        };
        const resp = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error(`OpenRouter prompts call failed: ${resp.status}`);
        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content || '';
        const parsed = JSON.parse(content);
        if (parsed && Array.isArray(parsed.imagePrompts)) {
            return parsed.imagePrompts;
        }
        return [];
    } catch (e) {
        const msg = String(e?.message || '');
        if (!msg.includes('402')) {
            console.warn('Prompt generation via AI failed or invalid, will fallback:', e.message);
        }
        return [];
    }
}

function createPromptsWithTemplate(sentences, styleData) {
    const style = styleData?.style || 'digital art, educational illustration, clean, colorful';
    const mood = styleData?.mood || 'inspiring, friendly, clear';
    const camera = styleData?.camera || 'medium shot, slight perspective, soft lighting';
    const environment = styleData?.environment || 'classroom or simple educational setting';

    return sentences.map((sentence, idx) => ({
        prompt: `Illustration ${idx + 1}: ${sentence} | Style: ${style} | Mood: ${mood} | Camera: ${camera} | Environment: ${environment} | Consistency: same character design and palette across frames; scene ${idx + 1} continues logically from scene ${idx}.`
    }));
}

module.exports = { generatePrompt };    