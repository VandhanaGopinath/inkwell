const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post('/recognize', async (req, res) => {
  try {
    const { imageData } = req.body;
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData }},
          { type: 'text', text: 'Transcribe all handwritten text visible in this image. Return only the text, no explanations.' }
        ]
      }]
    });
    res.json({ text: response.content[0].text });
  } catch (e) {
    console.error('Recognize error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/translate', async (req, res) => {
  try {
    const { text, language } = req.body;
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: `Translate to ${language}. Return only translated text:\n\n${text}` }]
    });
    res.json({ text: response.content[0].text });
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
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: `${prompts[mode]||prompts.summary}\n\nNotes:\n${text}` }]
    });
    res.json({ text: response.content[0].text });
  } catch (e) {
    console.error('Summarize error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;