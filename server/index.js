const express = require('express');
const { YoutubeTranscript } = require('youtube-transcript');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Private-Network', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Request-Private-Network');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.get('/health', (_req, res) => {
  res.header('Access-Control-Allow-Private-Network', 'true');
  res.json({ ok: true });
});

app.get('/transcript', async (req, res) => {
  const { videoId, lang = 'en' } = req.query;

  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
  }

  try {
    let segments;
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId, { lang });
    } catch (_) {
      segments = await YoutubeTranscript.fetchTranscript(videoId);
    }
    return res.json({ segments });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log('KeyFrames server running on port 3000');
});
