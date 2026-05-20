# KeyFrames

A Chrome extension that turns any YouTube video into a structured, skimmable document: chapters, summaries, and takeaways, injected directly into the YouTube sidebar.

## What It Does

KeyFrames injects a sidebar into YouTube's secondary column with:

- **Chapter list**: each title is a clickable timestamp that seeks the video
- **3–5 sentence summary** per chapter
- **Concrete takeaways** for each chapter
- **One-click Markdown export** of the full summary

It works on **any** video. If the video already has chapters, KeyFrames uses them and summarizes each one. If it doesn't, Claude generates intelligent chapters from the transcript, then summarizes those. Most YouTube videos have no chapters, so that's where this shines.

It handles both manual captions and auto-generated (ASR) captions, and works across languages (Claude handles translation implicitly).

---

## Setup

### 1. Start the transcript server

```bash
cd server
npm install
node index.js
```

The server runs on `http://localhost:3000`. It's a lightweight local Express server that fetches YouTube transcripts; YouTube blocks transcript requests from cloud IPs, so it needs to run on your machine.

### 2. Load the extension

- Open `chrome://extensions` → enable **Developer mode**
- Click **Load unpacked** → select the project root folder

### 3. Set your API key

- Click the KeyFrames icon in the toolbar
- Paste your Anthropic API key (`sk-ant-…`)

### 4. Use it

Navigate to any YouTube video. The sidebar appears automatically. Hard-refresh (`Cmd+Shift+R`) if it doesn't show up on the first load.

---

## Architecture

**Content script**: runs on `youtube.com/watch*`. Parses `ytInitialPlayerResponse` directly from inline `<script>` tag text (content scripts live in an isolated JS world and can't access page variables). Extracts chapters via two paths: the `playerOverlays` object, and a fallback into `ytInitialData`'s `engagementPanels`. Renders the sidebar in a **Shadow DOM** so styles are fully isolated from YouTube's, with no leakage in either direction.

**Service worker**: owns all Claude API calls. YouTube's CSP blocks `fetch` to `api.anthropic.com` from content scripts; the service worker has no such restriction and acts as a clean proxy. It runs a two-stage AI pipeline:

1. Generate chapters from a compressed transcript (~1 sample/minute, ~120 lines for a 2-hour video)
2. Summarize each chapter's segment window with key takeaways

Chapters render as skeletons immediately and fill in progressively as each summary arrives. An **in-memory cache** keyed by `videoId` means re-opening the sidebar on the same video costs zero API calls.

**Express server** (`server/index.js`): uses the `youtube-transcript` npm package, which derives auth parameters from the video page HTML and works around YouTube's session-based timedtext API validation.

---

## Demo Videos

Three videos that show the range of what KeyFrames handles:

**[But what is a neural network? | 3Blue1Brown](https://www.youtube.com/watch?v=aircAruvnKk)**
A video with manual subtitles and YouTube-native chapters. KeyFrames picks up the existing chapters and summarizes each one, good baseline demo of the summarization pipeline on a well-structured technical video.

**[Luma Agents Demo](https://www.youtube.com/watch?v=c_aGQouM6wk)**
A product demo with no chapters. KeyFrames falls back to ASR captions, generates chapters from scratch using Claude, then summarizes each and shows the full AI pipeline end-to-end.

**[Etienne Chouard - TEDxRepubliquesquare](https://www.youtube.com/watch?v=oN5tdMSXWV8)**
A French-language TED Talk. The `youtube-transcript` library fetches French captions; Claude generates English chapters and summaries. Cross-language support with no special-casing.

---

## Known Limitations

- **Local server required**: the main UX friction. Users need a terminal open while using the extension. A native messaging host would fix this but hasn't been built yet.
- **YouTube schema changes**: `ytInitialPlayerResponse` and `ytInitialData` change without notice and will eventually need updating.
- **In-memory cache only**: the service worker cache clears on restart, so the first load on a revisited video re-calls Claude.

## What's Next

- Replace the Node server with a Chrome native messaging host, same reliability, no terminal required
- Smarter transcript compression for very long videos
- Per-chapter retry UI when the API rate-limits mid-session
- Persistent summary storage via IndexedDB
- Notion / Google Docs export (the data model already supports it)
