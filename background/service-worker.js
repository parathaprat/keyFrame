// background/service-worker.js
//
// Owns all Claude API communication. Content scripts cannot fetch to
// api.anthropic.com directly because YouTube's CSP blocks it; the
// service worker has no such restriction.
//
// Message protocol (chrome.runtime.onMessage):
//   GENERATE_CHAPTERS  { segments: [{start, dur, text}], videoDuration: number, videoId: string }
//     → { chapters: [{title, startSeconds}] }
//
//   SUMMARIZE_CHAPTER  { title: string, segments: [{start, text}], chapterIndex: number, videoId: string }
//     → { summary: string, takeaways: string[] }

// ─── Config ───────────────────────────────────────────────────────────────────

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL   = 'claude-sonnet-4-20250514';

// ─── In-memory cache ──────────────────────────────────────────────────────────

// Keyed by videoId. Stores { chapters, summaries: { [chapterIndex]: result } }
// so re-opening the sidebar on the same video skips all Claude calls.
// Cleared on service worker restart (acceptable — SW restarts are infrequent).
const videoCache = new Map();

function getCached(videoId, key) {
  return videoCache.get(videoId)?.[key] ?? null;
}

function setCached(videoId, key, value) {
  if (!videoCache.has(videoId)) videoCache.set(videoId, { summaries: {} });
  if (key === 'summary') {
    // chapterIndex stored separately under summaries
    throw new Error('use setCachedSummary for per-chapter results');
  }
  videoCache.get(videoId)[key] = value;
}

function getCachedSummary(videoId, chapterIndex) {
  return videoCache.get(videoId)?.summaries?.[chapterIndex] ?? null;
}

function setCachedSummary(videoId, chapterIndex, result) {
  if (!videoCache.has(videoId)) videoCache.set(videoId, { summaries: {} });
  videoCache.get(videoId).summaries[chapterIndex] = result;
}

// ─── API key ──────────────────────────────────────────────────────────────────

function getApiKey() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('anthropicApiKey', result => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!result.anthropicApiKey)  return reject(new Error('NO_API_KEY'));
      resolve(result.anthropicApiKey);
    });
  });
}

// ─── Core Claude call ─────────────────────────────────────────────────────────

async function callClaude(apiKey, systemPrompt, userMessage, maxTokens = 1024) {
  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

// Calls Claude and parses the response as JSON. Strips markdown code fences if
// present. Retries once with an explicit correction prompt if parsing fails.
async function callClaudeForJson(apiKey, systemPrompt, userMessage, maxTokens = 1024) {
  const stripFences = t => t.replace(/```(?:json)?\n?([\s\S]*?)\n?```/g, '$1').trim();

  const text = await callClaude(apiKey, systemPrompt, userMessage, maxTokens);
  try {
    return JSON.parse(stripFences(text));
  } catch {
    // One retry: tell Claude its response was unparseable
    const retryText = await callClaude(
      apiKey,
      systemPrompt,
      userMessage + '\n\nYour previous response could not be parsed as JSON. ' +
        'Return ONLY raw JSON — no markdown, no code fences, no explanation.',
      maxTokens,
    );
    try {
      return JSON.parse(stripFences(retryText));
    } catch {
      throw new Error('Claude returned invalid JSON after retry');
    }
  }
}

// ─── Transcript compression ───────────────────────────────────────────────────

// Samples one segment per 5-minute window so even a 3-hour lecture fits
// comfortably in the context window (~36 lines for a 3-hour video).
function compressTranscript(segments) {
  const sampled = new Map(); // windowIndex → first segment in that window

  for (const seg of segments) {
    const window = Math.floor(seg.start / 300);
    if (!sampled.has(window)) sampled.set(window, seg);
  }

  return Array.from(sampled.entries())
    .sort(([a], [b]) => a - b)
    .map(([, seg]) => `[${fmtTime(seg.start)}] ${seg.text}`)
    .join('\n');
}

function fmtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Chapter generation ───────────────────────────────────────────────────────

async function generateChapters(apiKey, segments, videoId) {
  const cached = getCached(videoId, 'chapters');
  if (cached) return cached;

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

  const raw = await callClaudeForJson(apiKey, system, user, 512);

  // Normalise: Claude might return { chapters: [...] } instead of a bare array
  const chapters = Array.isArray(raw) ? raw : raw.chapters ?? raw;
  if (!Array.isArray(chapters) || chapters.length === 0) {
    throw new Error('Claude returned an empty or malformed chapters array');
  }

  // Guarantee first chapter starts at 0
  if (chapters[0].startSeconds !== 0) chapters.unshift({ title: chapters[0].title, startSeconds: 0 });

  if (videoId) setCached(videoId, 'chapters', chapters);
  return chapters;
}

// ─── Chapter summarization ────────────────────────────────────────────────────

async function summarizeChapter(apiKey, title, segments, chapterIndex, videoId) {
  const cached = getCachedSummary(videoId, chapterIndex);
  if (cached) return cached;

  // Build a readable transcript block from segments
  const transcript = segments
    .map(s => `[${fmtTime(s.start)}] ${s.text}`)
    .join('\n');

  const system = `You are an expert at summarizing video content and extracting key insights.
Return ONLY a JSON object with no other text, markdown, or explanation.
Format: {"summary": "...", "takeaways": ["...", "..."]}
Rules:
- summary: 3-5 sentences covering the main ideas of this chapter.
- takeaways: 3-5 specific, concrete bullets — not vague observations.`;

  const user = `Chapter title: "${title}"\n\nTranscript:\n${transcript}`;

  const result = await callClaudeForJson(apiKey, system, user, 512);

  if (!result.summary || !Array.isArray(result.takeaways)) {
    throw new Error('Claude returned malformed summary object');
  }

  if (videoId) setCachedSummary(videoId, chapterIndex, result);
  return result;
}

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;

  if (type === 'GENERATE_CHAPTERS') {
    const { segments, videoId } = payload;
    getApiKey()
      .then(apiKey => generateChapters(apiKey, segments, videoId))
      .then(chapters => sendResponse({ ok: true, chapters }))
      .catch(err    => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (type === 'SUMMARIZE_CHAPTER') {
    const { title, segments, chapterIndex, videoId } = payload;
    getApiKey()
      .then(apiKey => summarizeChapter(apiKey, title, segments, chapterIndex, videoId))
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(err   => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
