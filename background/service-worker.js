// background/service-worker.js
//
// Owns all Claude API communication. Content scripts cannot fetch to
// api.anthropic.com directly because YouTube's CSP blocks it; the
// service worker has no such restriction.
//
// Message protocol (chrome.runtime.onMessage):
//   GENERATE_CHAPTERS  { transcript: [{start, dur, text}] }
//     → { chapters: [{title, startSeconds}] }
//
//   SUMMARIZE_CHAPTER  { title, startSeconds, segments: [{start, text}] }
//     → { summary: string, bullets: string[] }

// ─── Claude config ────────────────────────────────────────────────────────────

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL   = 'claude-opus-4-7';

// ─── API key ──────────────────────────────────────────────────────────────────

// Retrieved from chrome.storage.local, set by the user via popup.html.
async function getApiKey() {
  // TODO: return the stored key; reject with a user-facing error if absent
}

// ─── Core Claude call ─────────────────────────────────────────────────────────

// Generic wrapper around the Messages endpoint. All handlers go through here.
// Throws on non-2xx responses so callers can surface errors cleanly.
async function callClaude(systemPrompt, userMessage, maxTokens = 1024) {
  // TODO:
  //   1. getApiKey()
  //   2. POST to CLAUDE_API_URL with the correct headers
  //      (x-api-key, anthropic-version: 2023-06-01, content-type)
  //   3. Parse response, return content[0].text
  //   4. Throw a descriptive error on non-2xx so callers can relay it to the UI
}

// ─── Chapter generation ───────────────────────────────────────────────────────

// Called when the video has no built-in chapters.
// Compresses the transcript to a lightweight form before sending so that
// even 2-hour lectures stay well within the context window.
async function generateChapters(transcript) {
  // TODO:
  //   Compress transcript → one "timestamp: first sentence" line per ~5-minute
  //   window rather than every segment. Keeps token count low.
  //
  //   Prompt: ask Claude to return 4-8 chapters as JSON array
  //   [{title: string, startSeconds: number}]
  //   Parse and validate the JSON before returning.
}

// ─── Chapter summarization ────────────────────────────────────────────────────

// Called once per chapter, sequentially, by the content script.
// Receives only that chapter's transcript segments (not the full video).
async function summarizeChapter(title, startSeconds, segments) {
  // TODO:
  //   Join segment texts into a readable block (strip HTML entities).
  //   Cap at a safe token budget; truncate with notice if over.
  //
  //   Prompt: ask Claude for
  //     - A 3-5 sentence summary paragraph
  //     - 3-5 key takeaway bullets
  //   Parse response into { summary: string, bullets: string[] }
}

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Must return true to signal async response.
  const { type, payload } = message;

  if (type === 'GENERATE_CHAPTERS') {
    generateChapters(payload.transcript)
      .then(chapters => sendResponse({ ok: true, chapters }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (type === 'SUMMARIZE_CHAPTER') {
    const { title, startSeconds, segments } = payload;
    summarizeChapter(title, startSeconds, segments)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(err   => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
