# KeyFrames

A Chrome extension that turns any YouTube video into a structured, skimmable document: chapters, streaming AI summaries, takeaways, and quality scores, injected directly into the YouTube sidebar.

No terminal to keep open. No server to start. Load the extension, run one install script, done.

---

## Features

- **Streaming summaries**: words appear one by one as Claude generates them, just like a chat interface
- **Auto chapter detection**: uses YouTube's native chapters if they exist; if not, Claude generates intelligent chapters from the transcript
- **Per-chapter summaries**: 3–5 sentence summary for each chapter
- **Key takeaways**: 3–5 concrete, specific bullets per chapter
- **Coverage score**: lexical overlap between the summary and the transcript (how much of the transcript's vocabulary the summary captures)
- **Quality score**: Claude's own rating (0–100) of how completely the summary captures the chapter's key ideas
- **Clickable timestamps**: every chapter header jumps the video to that point
- **One-click Markdown export**: downloads the full summary as a `.md` file
- **Cross-language support**: works on videos in any language; Claude translates implicitly
- **Shadow DOM isolation**: the sidebar's styles never leak into YouTube's UI and vice versa

---

## Requirements

- macOS (Chrome's native messaging host path is macOS-specific as written)
- [Node.js](https://nodejs.org) v18 or later
- An [Anthropic API key](https://console.anthropic.com)
- Google Chrome (or any Chromium-based browser that supports native messaging)

---

## Setup

Setup is a one-time, two-step process: load the extension into Chrome, then run the install script.

### Step 1: Load the extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the root `KeyFrames/` folder (the one containing `manifest.json`)
5. The KeyFrames card appears. Copy the **Extension ID** shown beneath the name (looks like `bgmpdnapjibnmkenmimmdnffbiknlepb`)

### Step 2: Save your Extension ID

Create a file called `.extension-id` inside the `host/` folder containing only your Extension ID:

```bash
echo "YOUR_EXTENSION_ID_HERE" > host/.extension-id
```

Replace `YOUR_EXTENSION_ID_HERE` with the ID you copied in Step 1.

### Step 3: Add your Anthropic API key

Create a `.env` file in the project root:

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

Replace `sk-ant-...` with your actual key from [console.anthropic.com](https://console.anthropic.com).

### Step 4: Run the install script

```bash
cd host
chmod +x install.sh
./install.sh
```

The script will:
- Install npm dependencies (`@anthropic-ai/sdk`, `youtube-transcript`, `dotenv`)
- Create a wrapper executable at `~/Library/Application Support/KeyFrames/keyframes-host`
- Register the native messaging host with Chrome at `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.keyframes.host.json`

### Step 5: Reload the extension

Go back to `chrome://extensions` and click the **reload** button (circular arrow) on the KeyFrames card.

That's it. Navigate to any YouTube video and the sidebar appears automatically.

---

## Usage

### Watching a video

Open any YouTube watch page (`youtube.com/watch?v=...`). KeyFrames automatically:

1. Detects the video's chapters (or generates them with Claude if none exist)
2. Fetches the transcript
3. Shows chapter skeletons while it works
4. Streams each chapter summary word-by-word into the sidebar
5. Displays the Coverage and Quality scores once each chapter is done

### Clicking timestamps

Every chapter header has a clickable timestamp badge. Clicking it seeks the video directly to that chapter's start time.

### Exporting notes

Once all chapters are summarized, the **Export Notes** button activates. Clicking it downloads a Markdown file (`keyframes-<videoId>.md`) with all chapter summaries and takeaways formatted for use in any notes app.

### Understanding the scores

| Badge | What it measures |
|-------|-----------------|
| **Coverage %** | Lexical overlap between the summary text and the original transcript. High means the summary reuses similar vocabulary to the source. |
| **Quality %** | Claude's own self-rating of how completely the summary captures the chapter's key ideas. More meaningful than coverage for judging actual comprehensiveness. |

Both badges are color-coded: green (≥70%), amber (40–69%), red (<40%).

### SPA navigation

YouTube is a single-page app. KeyFrames listens for `yt-navigate-finish` events and re-runs automatically when you navigate to a different video, no page reload needed.

---

## Architecture

```
Chrome Extension
├── content/content.js        # Injected into youtube.com/watch* pages
├── content/sidebar.css       # Sidebar styles (loaded into Shadow DOM)
├── background/service-worker.js  # Message relay between content script and host
└── host/
    ├── host.js               # Native messaging host (all AI logic lives here)
    ├── install.sh            # One-time setup script
    └── package.json
```

### Why a native messaging host?

YouTube's Content Security Policy blocks `fetch` calls to `api.anthropic.com` from content scripts. The extension service worker has no such restriction, but Manifest V3 service workers can't make long-running connections needed for streaming.

The solution is a **native messaging host**, a local Node.js process that Chrome spawns on demand. Chrome communicates with it over stdin/stdout using a simple framing protocol (4-byte little-endian length prefix + UTF-8 JSON). The host owns all Claude API calls, including streaming, caching, and transcript fetching.

### Request flow

```
YouTube page
  └─ content.js              detects video, injects sidebar
       └─ service-worker.js  relays messages over chrome.runtime
            └─ host.js       fetches transcript, calls Claude, streams response
```

For summarization, the flow is:

1. `content.js` sends `SUMMARIZE_CHAPTER` to the service worker
2. Service worker forwards it to the host via the native port, tagged with the sender's tab ID
3. Host opens a **streaming** Claude request; each text delta is sent back as `{ stream: true, text }`
4. Service worker receives each chunk and calls `chrome.tabs.sendMessage` to forward it directly to the content script tab
5. Content script appends each chunk to the chapter card in real time
6. When the stream ends, the host parses the structured data (takeaways, quality score), computes the coverage score locally, and sends a final `{ stream: false, ...result }` message
7. Service worker resolves the pending promise; content script renders the final formatted card

### Caching

Both chapter lists and chapter summaries are cached in memory on the host process (keyed by `videoId` and `videoId:chapterIndex` respectively). Re-opening the sidebar on the same video costs zero API calls for the session.

---

## Project Structure

```
KeyFrames/
├── manifest.json
├── .env                      # ANTHROPIC_API_KEY (create this yourself)
├── icons/
├── content/
│   ├── content.js
│   └── sidebar.css
├── background/
│   └── service-worker.js
└── host/
    ├── host.js
    ├── install.sh
    ├── package.json
    ├── .extension-id         # Create this with your Extension ID
    └── node_modules/
```

---

## Troubleshooting

**Sidebar doesn't appear**
Hard-refresh the page (`Cmd+Shift+R`). If it still doesn't show, check `chrome://extensions` for errors on the KeyFrames card.

**"Failed to load transcript: Native host disconnected"**
The host process failed to start. Check the log:
```bash
cat /tmp/keyframes-host.log
```
Common causes: `install.sh` hasn't been run, Node.js isn't on PATH, or the `.env` file is missing.

**"No transcript found for this video"**
The video has no captions (neither manual nor auto-generated), or the captions are member-only. KeyFrames can't proceed without a transcript.

**Summaries stop partway through**
You may have hit an Anthropic rate limit. The in-memory cache means completed chapters aren't re-requested on reload; refresh the page to resume from where it left off.

**After pulling new code**
Re-run `host/install.sh` if `host.js` or `install.sh` changed. Then reload the extension at `chrome://extensions`.

---

## Demo Videos

Three videos that show the range of what KeyFrames handles:

**[But what is a neural network? | 3Blue1Brown](https://www.youtube.com/watch?v=aircAruvnKk)**
Manual subtitles and YouTube-native chapters. KeyFrames uses the existing chapters and streams a summary for each, good baseline demo of the summarization pipeline on a well-structured technical video.

**[Luma Agents Demo](https://www.youtube.com/watch?v=c_aGQouM6wk)**
No chapters. KeyFrames falls back to ASR captions, generates chapters from scratch with Claude, then streams summaries for each, the full AI pipeline end-to-end.

**[Etienne Chouard - TEDxRepubliquesquare](https://www.youtube.com/watch?v=oN5tdMSXWV8)**
A French-language TED Talk. `youtube-transcript` fetches French captions; Claude generates English chapters and summaries. Cross-language support with no special-casing.
