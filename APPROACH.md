# KeyFrames — Approach

## What I Built

KeyFrames is a Chrome extension that turns any YouTube video into a structured, skimmable document. It injects a sidebar into YouTube's secondary column with chapters, a 3–5 sentence summary per chapter, and concrete takeaways. Every chapter title is a clickable timestamp that seeks the video. There's a one-click Markdown export of the full summary.

It works on **any** video, with or without existing chapters. If the video already has chapters, KeyFrames uses them and summarizes each one. If it doesn't, Claude generates intelligent chapters from the transcript first, then summarizes those. Most YouTube videos have no chapters; that's where this shines.

It handles both manual captions and auto-generated (ASR) captions, covering the vast majority of videos on the platform.

## Demo Videos

Three videos chosen to show the range of what KeyFrames handles:

**1. [But what is a neural network? | Deep learning chapter 1](https://www.youtube.com/watch?v=aircAruvnKk)**
A 3Blue1Brown explainer with manual subtitles and YouTube-native chapters. KeyFrames picks up the existing chapters directly and summarizes each one — no AI chapter generation needed. Good baseline demo of the summarization pipeline on a well-structured technical video.

**2. [Luma Agents Demo](https://www.youtube.com/watch?v=c_aGQouM6wk)**
A product demo video with no English subtitles and no chapters. KeyFrames falls back to ASR captions, generates chapters from scratch using Claude, then summarizes each. Shows the full AI pipeline end-to-end on content that YouTube itself gives you no structure for.

**3. [Etienne Chouard — Chercher la cause des causes (TEDxRepubliquesquare)](https://www.youtube.com/watch?v=oN5tdMSXWV8)**
A French-language TED Talk. The `youtube-transcript` library fetches the French captions, Claude generates English chapters and summaries from them. KeyFrames works across languages without any special-casing — the model handles translation implicitly.

## Why This Problem

YouTube is the world's largest library of long-form knowledge: lectures, conference talks, tutorials, interviews. It's almost entirely unsearchable and unskimmable. Scrubbing through a 2-hour video to find one specific argument is a real daily frustration. This felt like an obvious fit for an AI company like Luma that is building at the intersection of video and intelligence: the raw material (transcripts) is already there, and a well-prompted LLM turns it into something genuinely more useful than the original. The extension format also means zero friction for the end user — it lives where they already watch.

## How to Run

**1. Start the transcript server**

```
cd server
npm install
node index.js
```

Server runs on http://localhost:3000.

**2. Load the extension**

- Open `chrome://extensions` → Enable Developer mode
- Click "Load unpacked" → select the project root folder

**3. Set your API key**

- Click the KeyFrames icon → paste your Anthropic API key (`sk-ant-…`)

**4. Use it**

- Navigate to any YouTube video. The sidebar appears automatically. Hard Refresh (Cmd + Shift + R) if it does not.

## Architecture

**Content script** — runs on `youtube.com/watch*`. Parses `ytInitialPlayerResponse` directly from inline `<script>` tag text (content scripts live in an isolated JS world and can't touch page variables). Extracts chapters via two paths: the `playerOverlays` object, and a fallback into `ytInitialData`'s `engagementPanels`. Renders the sidebar in a **Shadow DOM** so our styles are completely isolated from YouTube's — no leakage in either direction.

**Service worker** — owns all Claude API calls. YouTube's CSP blocks `fetch` to `api.anthropic.com` from content scripts; the service worker has no such restriction and acts as a clean proxy. It runs a two-stage AI pipeline: first, generate chapters from a compressed transcript (one sample per minute, ~120 lines for a 2-hour video); then, summarize each chapter's segment window with key takeaways. Chapters render as skeletons immediately and fill in progressively as each summary arrives. An **in-memory cache** keyed by `videoId` means re-opening the sidebar on the same video costs zero API calls.

**Express server** (`server/index.js`) — a lightweight local server using the `youtube-transcript` npm package, which the service worker calls to fetch transcripts.

## The Transcript Constraint

YouTube's timedtext API validates requests against the page session, fetches from content scripts, service workers, and cloud servers all return empty. The `youtube-transcript` package works around this by deriving auth parameters from the video page HTML, which only works from a real user IP. I tried deploying to Railway; YouTube blocks datacenter IPs entirely. The local server is the honest solution: it runs on the user's machine, looks like a real browser, and works reliably.

## What I Left Out

- **Auth and cross-device sync** — not needed for a single-user extension; the API key lives in `chrome.storage.local` and the in-memory cache is per-session by design.
- **Notion / Google Docs export** — the obvious next integration after Markdown export; the data model already supports it, it's just another serialisation target.
- **Persistent summary storage** — saving past summaries to IndexedDB so they survive service worker restarts would meaningfully improve the repeat-visit experience.
- **Cloud transcript server** — I built and deployed to Railway but YouTube blocks datacenter IPs. Covered in the transcript section above.

## What Breaks First

The local server is the main UX friction, users need a terminal. The YouTube data schema (`ytInitialPlayerResponse`, `ytInitialData`) changes without notice and will eventually need updating. The service worker cache clears on restart, so the first load on a revisited video re-calls Claude.

## What I'd Build Next

Replace the Node server with a Chrome native messaging host with the same reliability, no terminal required, installs with the extension. Smarter transcript compression for very long videos. Per-chapter retry UI for when the API rate-limits mid-session.
