#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Anthropic } = require('@anthropic-ai/sdk');
const { YoutubeTranscript } = require('youtube-transcript');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory caches
const chapterCache = new Map();  // videoId → chapters
const summaryCache = new Map();  // `${videoId}:${chapterIndex}` → { summary, takeaways, similarityScore, qualityScore }

// ─── Native Messaging Protocol ─────────────────────────────────────────────────

let inputBuffer = Buffer.alloc(0);

process.stdin.on('readable', () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
  }
  processBuffer();
});

process.stdin.on('end', () => {
  process.exit(0);
});

function processBuffer() {
  while (inputBuffer.length >= 4) {
    const msgLength = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < 4 + msgLength) break;

    const msgText = inputBuffer.slice(4, 4 + msgLength).toString('utf8');
    inputBuffer = inputBuffer.slice(4 + msgLength);

    let message;
    try {
      message = JSON.parse(msgText);
    } catch {
      continue;
    }

    handleMessage(message);
  }
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.alloc(4 + Buffer.byteLength(json));
  buf.writeUInt32LE(Buffer.byteLength(json), 0);
  buf.write(json, 4);
  process.stdout.write(buf);
}

// ─── Message Router ────────────────────────────────────────────────────────────

async function handleMessage(message) {
  const { requestId, type, ...payload } = message;

  try {
    let result;
    if (type === 'FETCH_TRANSCRIPT') {
      result = await handleFetchTranscript(payload);
    } else if (type === 'GENERATE_CHAPTERS') {
      result = await handleGenerateChapters(payload);
    } else if (type === 'SUMMARIZE_CHAPTER') {
      result = await handleSummarizeChapter(payload);
    } else {
      result = { ok: false, error: `Unknown message type: ${type}` };
    }
    sendMessage({ requestId, ...result });
  } catch (err) {
    sendMessage({ requestId, ok: false, error: err.message });
  }
}

// ─── FETCH_TRANSCRIPT ──────────────────────────────────────────────────────────

async function handleFetchTranscript({ videoId }) {
  try {
    let segments;
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    } catch {
      segments = await YoutubeTranscript.fetchTranscript(videoId);
    }
    return { ok: true, segments };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── GENERATE_CHAPTERS ─────────────────────────────────────────────────────────

function fmtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// Segments here are already content.js-processed: { start (seconds), dur, text }
function compressTranscript(segments) {
  const sampled = new Map();
  for (const seg of segments) {
    const window = Math.floor(seg.start / 60);
    if (!sampled.has(window)) sampled.set(window, seg);
  }
  return Array.from(sampled.entries())
    .sort(([a], [b]) => a - b)
    .map(([, seg]) => `[${fmtTime(seg.start)}] ${seg.text}`)
    .join('\n');
}

function extractJson(text) {
  const stripped = text.replace(/```(?:json)?\n?([\s\S]*?)\n?```/g, '$1').trim();
  try { return JSON.parse(stripped); } catch {}
  const arr = stripped.match(/(\[[\s\S]*\])/);
  if (arr) { try { return JSON.parse(arr[1]); } catch {} }
  const obj = stripped.match(/(\{[\s\S]*\})/);
  if (obj) { try { return JSON.parse(obj[1]); } catch {} }
  return null;
}

async function callClaudeForJson(systemPrompt, userMessage, maxTokens) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].text;
  const result = extractJson(text);
  if (result !== null) return result;

  // One retry with correction
  const retryResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    temperature: 0.2,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: text },
      { role: 'user', content: 'Your previous response could not be parsed as JSON. Return ONLY raw JSON — no markdown, no code fences, no explanation.' },
    ],
  });

  const retryResult = extractJson(retryResponse.content[0].text);
  if (retryResult !== null) return retryResult;

  throw new Error('Claude returned invalid JSON after retry');
}

async function handleGenerateChapters({ segments, videoId }) {
  if (chapterCache.has(videoId)) {
    return { ok: true, chapters: chapterCache.get(videoId) };
  }

  const compressed = compressTranscript(segments);

  const system = `You are an expert at analyzing video transcripts and identifying logical chapter boundaries.
Return ONLY a JSON array with no other text, markdown, or explanation.
Format: [{"title": "Descriptive Chapter Title", "startSeconds": 0}, ...]
Rules:
- Generate between 4 and 8 chapters.
- Titles must be specific and descriptive. Do NOT use generic titles like "Introduction", "Conclusion", or "Section 1".
- startSeconds must correspond to a real timestamp visible in the transcript.
- The first chapter must start at startSeconds 0.
- Chapters must be in ascending order by startSeconds.`;

  const user = `Analyze this compressed transcript and identify 4-8 logical chapters.\n\n${compressed}`;

  const raw = await callClaudeForJson(system, user, 512);

  let chapters = Array.isArray(raw) ? raw : (raw.chapters ?? raw);
  if (!Array.isArray(chapters) || chapters.length === 0) {
    throw new Error('Claude returned an empty or malformed chapters array');
  }

  if (chapters[0].startSeconds !== 0) {
    chapters.unshift({ title: chapters[0].title, startSeconds: 0 });
  }

  chapterCache.set(videoId, chapters);
  return { ok: true, chapters };
}

// ─── Text similarity ──────────────────────────────────────────────────────────

// TF cosine similarity between two strings. Returns 0.0–1.0.
// Sufficient for coverage scoring without any external API.
function tfidfCosine(text1, text2) {
  const tokenize = t => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const tf = tokens => {
    const map = new Map();
    for (const t of tokens) map.set(t, (map.get(t) || 0) + 1);
    return map;
  };

  const tf1 = tf(tokenize(text1));
  const tf2 = tf(tokenize(text2));
  const terms = new Set([...tf1.keys(), ...tf2.keys()]);

  let dot = 0, mag1 = 0, mag2 = 0;
  for (const term of terms) {
    const v1 = tf1.get(term) || 0;
    const v2 = tf2.get(term) || 0;
    dot += v1 * v2;
    mag1 += v1 * v1;
    mag2 += v2 * v2;
  }
  if (mag1 === 0 || mag2 === 0) return 0;
  return dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

// ─── SUMMARIZE_CHAPTER ─────────────────────────────────────────────────────────

async function handleSummarizeChapter({ title, segments, chapterIndex, videoId }) {
  const cacheKey = `${videoId}:${chapterIndex}`;
  if (summaryCache.has(cacheKey)) {
    return { ok: true, ...summaryCache.get(cacheKey) };
  }

  const formattedTranscript = segments
    .map(s => `[${fmtTime(s.start)}] ${s.text}`)
    .join('\n');

  const system = `You are an expert at summarizing video content and extracting key insights.
Return ONLY a JSON object with no other text, markdown, or explanation.
Format: {"summary": "...", "takeaways": ["...", "..."], "quality_score": 85}
Rules:
- summary: 3-5 sentences covering the main ideas of this chapter.
- takeaways: 3-5 specific, concrete bullets — not vague observations.
- quality_score: integer 0-100 rating how completely the summary captures the key ideas of the transcript. 90+ means nearly everything important is covered; below 50 means significant ideas were missed.`;

  const user = `Chapter title: "${title}"\n\nTranscript:\n${formattedTranscript}`;

  const result = await callClaudeForJson(system, user, 1024);

  if (!result.summary || !Array.isArray(result.takeaways)) {
    throw new Error('Claude returned malformed summary object');
  }

  const transcriptText = segments.map(s => s.text).join(' ');
  const summaryText = result.summary + ' ' + result.takeaways.join(' ');
  const similarityScore = Math.round(tfidfCosine(summaryText, transcriptText) * 100);
  const qualityScore = typeof result.quality_score === 'number'
    ? Math.min(100, Math.max(0, Math.round(result.quality_score)))
    : null;

  const cached = { summary: result.summary, takeaways: result.takeaways, similarityScore, qualityScore };
  summaryCache.set(cacheKey, cached);
  return { ok: true, ...cached };
}
