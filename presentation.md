# KeyFrames: Agentic Project Retrospective

---

## Slide 1: The Problem

**YouTube is the world's largest knowledge base. It's unsearchable.**

A 2-hour lecture, a deep-dive podcast, a conference talk. The information is locked inside a video. You have to watch the whole thing to know if minute 47 is the part you actually needed.

**KeyFrames turns any YouTube video into a skimmable document, injected directly into the YouTube sidebar.**

- Chapters with clickable timestamps
- Streaming AI summaries per chapter
- Key takeaways + quality scores
- One-click Markdown export

Works on any video. If the video has chapters, it uses them. If it doesn't (which is most of YouTube), Claude generates chapters from the transcript and summarizes each one.

The transcript is already there. The structure just needs to be surfaced.

---

## Slide 2: Architecture

```
YouTube Page
    │
    ├── content.js          Parses page, injects sidebar (Shadow DOM)
    │       │
    │       └── service-worker.js    Message relay (no API logic)
    │                   │
    │                   └── host.js (Native Messaging)
    │                           ├── youtube-transcript  → fetch transcript
    │                           ├── Claude              → generate chapters
    │                           └── Claude (streaming)  → summarize + score
```

Three design choices worth calling out:

1. **Native Messaging Host:** YouTube's CSP blocks API calls from content scripts. A local Node.js process that Chrome spawns on demand owns all Claude calls. No terminal to keep open.

2. **Shadow DOM:** The sidebar's styles are fully isolated from YouTube's. No fragile CSS overrides, no bleed in either direction.

3. **SPA-aware navigation:** YouTube is a single-page app. The content script listens for `yt-navigate-finish` and reruns the full pipeline on navigation, with an in-memory cache so revisited videos cost zero API calls.

---

## Slide 3: v1 to v2

| | v1 | v2 |
|---|---|---|
| **Transcript / AI** | Local Express server + service worker Claude calls | Native Messaging Host owns everything |
| **Setup** | `npm start` in a terminal, kept open forever | `./install.sh` once, never again |
| **Scores** | BERTScore via OpenAI embeddings | TF cosine (local) + Claude self-rating |
| **Summaries** | Block render on completion | Streaming, words appear as Claude generates |
| **Dependencies** | Anthropic + OpenAI | Anthropic only |

The main v1 problem was that users had to keep a terminal open with a running server. Every demo, every use. Hard blocker for anyone non-technical.

The fix: Chrome's Native Messaging protocol lets you register a local executable that Chrome spawns on demand over stdin/stdout. No server, no terminal, one install script run once.

OpenAI got removed because BERTScore blocked every summary response waiting on an embeddings call. When the key was invalid it silently killed all summaries. Claude can self-rate quality in the same call anyway, so the dependency wasn't earning its keep.

---

## Slide 4: The AI Pipeline

Three Claude calls per video, each with a specific job:

**① Generate Chapters** *(only runs if the video has no chapters)*
- Compress the transcript to roughly one sample per minute
- Claude identifies 4-8 logical chapter boundaries with descriptive titles
- Returns `[{ title, startSeconds }]`

**② Summarize Each Chapter**
- Claude gets the transcript window for that chapter
- Returns a 3-5 sentence summary, 3-5 concrete takeaways, and a quality score out of 100
- Streamed word by word so the UI feels live

**③ Score Coverage** *(runs locally, no API call)*
- TF cosine similarity between the summary text and the transcript
- Paired with Claude's quality score to give two independent signals on how good the summary is

What makes this agentic: Claude isn't just answering a question in isolation. Chapter generation feeds directly into summarization. The output of one call is the structured input to the next. The model is making decisions about structure and relevance that drive what the user actually sees.

---

## Slide 5: Retrospective

**What worked**
- Native messaging is solid once installed, zero friction on every subsequent use
- Shadow DOM was the right call, YouTube's UI has changed multiple times and the sidebar never broke
- Streaming made the product feel noticeably more alive with no change to actual latency

**What I'd do differently**

Transcript fetching probably belongs in the browser. The native host exists partly because of the `youtube-transcript` npm package, but in hindsight the content script already parses `ytInitialPlayerResponse` and the caption track URLs live in that same object. A pure browser extension with no install step at all is achievable. I picked the faster path when the better path was just a bit more extraction work.

Per-chapter error recovery is missing. When a chapter fails mid-pipeline the card shows a generic error message with no way to retry. A retry button would take about 30 minutes to build and would noticeably improve the experience.

**What's next**
- Deterministic extension ID via a manifest key field, making it a true drag-and-drop install
- Persistent cache with IndexedDB so summaries survive browser restarts
- Notion and Obsidian export (the data model already supports it)

The main thing this project taught me: the hardest part of building with AI isn't the model call. It's the plumbing around it. Getting the transcript reliably, handling SPA navigation, isolating styles, streaming across a messaging boundary. Once that's solid, the model is actually the easy part.
