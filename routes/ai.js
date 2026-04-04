const router = require('express').Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

async function callGemini(contents) {
  const fetch = (await import('node-fetch')).default;
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates[0].content.parts[0].text;
}

router.post('/recognize', async (req, res) => {
  try {
    const { imageData } = req.body;
    const text = await callGemini([{
      role: 'user',
      parts: [
        { inline_data: { mime_type: 'image/png', data: imageData } },
        { text: 'Transcribe all handwritten text visible in this image. Return only the text, no explanations.' }
      ]
    }]);
    res.json({ text });
  } catch (e) {
    console.error('Recognize error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/translate', async (req, res) => {
  try {
    const { text, language } = req.body;
    const result = await callGemini([{
      role: 'user',
      parts: [{ text: `Translate to ${language}. Return only translated text:\n\n${text}` }]
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
    const result = await callGemini([{
      role: 'user',
      parts: [{ text: `${prompts[mode] || prompts.summary}\n\nNotes:\n${text}` }]
    }]);
    res.json({ text: result });
  } catch (e) {
    console.error('Summarize error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
