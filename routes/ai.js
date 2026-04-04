const router = require('express').Router();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const TEXT_MODEL = 'llama3-8b-8192';

async function callGroq(messages, useVision = false) {
  const fetch = (await import('node-fetch')).default;
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: useVision ? VISION_MODEL : TEXT_MODEL,
      messages,
      max_tokens: 1000,
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

router.post('/recognize', async (req, res) => {
  try {
    const { imageData } = req.body;
    const text = await callGroq([{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageData}` } },
        { type: 'text', text: 'Transcribe all handwritten text visible in this image. Return only the text, no explanations.' }
      ]
    }], true);
    res.json({ text });
  } catch (e) {
    console.error('Recognize error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/translate', async (req, res) => {
  try {
    const { text, language } = req.body;
    const result = await callGroq([{
      role: 'user',
      content: `Translate to ${language}. Return only translated text:\n\n${text}`
    }]);
    res.json({ text: result });
  } catch (e) {
    console.error('Translate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/summarize', async (req, res) => {
  try {
    const { text, mode } = req.body;
    const prompts = {
      summary: 'Write a clear concise summary. Return only the summary.',
      bullets: 'Extract key points as bullet list using •. Return only bullets.',
      insights: 'Extract important insights as numbered list.'
    };
    const result = await callGroq([{
      role: 'user',
      content: `${prompts[mode] || prompts.summary}\n\nNotes:\n${text}`
    }]);
    res.json({ text: result });
  } catch (e) {
    console.error('Summarize error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;