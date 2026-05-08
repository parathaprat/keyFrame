// content/content.js
//
// Injected into every https://www.youtube.com/watch* page.
// Responsible for:
//   1. Extracting transcript + chapter data from the page
//   2. Orchestrating Claude calls (via messages to service worker)
//   3. Building and updating the sidebar in #secondary

// ─── Constants ────────────────────────────────────────────────────────────────

const SIDEBAR_ID        = 'keyframes-root';
const SECONDARY_SEL     = '#secondary';
const VIDEO_SEL         = 'video';

// ─── Phase 1 · Extraction ─────────────────────────────────────────────────────

// Parses ytInitialPlayerResponse out of the raw page HTML.
// Content scripts run in an isolated JS world and cannot access page-level
// variables directly, so we extract the JSON from the <script> tag text.
// Returns the parsed object, or null if not found.
function extractPlayerResponse() {
  try {
    for (const script of document.querySelectorAll('script')) {
      if (!script.textContent.includes('ytInitialPlayerResponse')) continue;
      const match = script.textContent.match(/ytInitialPlayerResponse\s*=\s*({.+?});/s);
      if (match) return JSON.parse(match[1]);
    }
    return null;
  } catch {
    return null;
  }
}

// Returns an array of {title, startSeconds} from the playerResponse chapters
// path, or an empty array if the video has no chapters.
function extractChapters(playerResponse) {
  const chapters = playerResponse
    ?.playerOverlays
    ?.playerOverlayRenderer
    ?.decoratedPlayerBarRenderer
    ?.decoratedPlayerBarRenderer
    ?.playerBar
    ?.multiMarkersPlayerBarRenderer
    ?.markersMap?.[0]?.value?.chapters;

  if (!Array.isArray(chapters) || chapters.length === 0) return [];

  return chapters.map(ch => ({
    title:        ch.chapterRenderer.title.simpleText,
    startSeconds: ch.chapterRenderer.timeRangeStartMillis / 1000,
  }));
}

// Returns the URL string for the first English caption track, or null.
function extractCaptionUrl(playerResponse) {
  const tracks = playerResponse
    ?.captions
    ?.playerCaptionsTracklistRenderer
    ?.captionTracks;

  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  const track = tracks.find(t => t.languageCode === 'en') ?? tracks[0];
  return track.baseUrl ?? null;
}

// Fetches the caption XML from YouTube and returns parsed segments.
// Returns [{start: number, dur: number, text: string}].
async function fetchTranscript(captionUrl) {
  const response = await fetch(captionUrl);
  const xmlText  = await response.text();
  const doc      = new DOMParser().parseFromString(xmlText, 'text/xml');

  return Array.from(doc.querySelectorAll('text')).map(el => ({
    start: parseFloat(el.getAttribute('start')),
    dur:   parseFloat(el.getAttribute('dur')),
    text:  el.textContent
      .replace(/&amp;/g,  '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g,  "'")
      .replace(/&lt;/g,   '<')
      .replace(/&gt;/g,   '>'),
  }));
}

// Merges transcript segments into chapters by assigning each segment to the
// chapter whose startSeconds is closest without going over.
// Mutates chapters in place, adding a `segments` array to each.
function assignSegmentsToChapters(segments, chapters) {
  chapters.sort((a, b) => a.startSeconds - b.startSeconds);
  chapters.forEach(ch => { ch.segments = []; });

  for (const segment of segments) {
    // Find the last chapter whose startSeconds is <= segment.start
    let bucket = 0;
    for (let i = 1; i < chapters.length; i++) {
      if (chapters[i].startSeconds <= segment.start) bucket = i;
      else break;
    }
    chapters[bucket].segments.push(segment);
  }
}

// ─── Phase 2 · Sidebar (Shadow DOM) ──────────────────────────────────────────

// Injects the KeyFrames sidebar into YouTube's #secondary column and returns
// the shadow root so subsequent functions can query into it safely.
// Shadow DOM prevents our CSS from leaking into YouTube's styles and vice versa.
async function injectSidebar() {
  // TODO:
  //   1. Remove any existing sidebar (navigation re-use case)
  //   2. Create a <div id="keyframes-root">
  //   3. shadowRoot = div.attachShadow({ mode: 'open' })
  //   4. Fetch sidebar.css via chrome.runtime.getURL and inject as <style>
  //   5. Inject skeleton HTML: header, loading state, chapter list container
  //   6. Prepend div into document.querySelector('#secondary')
  //   7. Return shadowRoot
}

// Renders the chapter list into the shadow root.
// Each chapter card starts in a loading state; summaries are filled in
// progressively as SUMMARIZE_CHAPTER responses arrive.
function renderChapterSkeleton(shadowRoot, chapters) {
  // TODO:
  //   For each chapter, create a card element with:
  //     - Timestamp button (clicking seeks the video)
  //     - Chapter title
  //     - A loading spinner / placeholder for the summary
  //     - A placeholder for bullet points
  //   Give each card a data-index attribute for targeted updates.
}

// Updates a single chapter card in-place once its summary arrives.
function updateChapterCard(shadowRoot, index, summary, bullets) {
  // TODO:
  //   querySelector('[data-index="<index>"]')
  //   Replace spinner with summary text + bullet list
  //   Add a subtle fade-in so the user sees progress
}

// Renders an error state for a specific chapter card.
function markChapterError(shadowRoot, index, errorMessage) {
  // TODO: replace spinner with an error notice and retry affordance
}

// ─── Phase 3 · Orchestration ──────────────────────────────────────────────────

// Sends a message to the service worker and returns a Promise.
// Rejects if the service worker signals ok: false.
function sendToBackground(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response.ok)             return reject(new Error(response.error));
      resolve(response);
    });
  });
}

// Main pipeline. Runs once per page load / SPA navigation.
async function init() {
  // Guard: only run on watch pages
  if (!location.pathname.startsWith('/watch')) return;

  // ── Step 1: extract data ───────────────────────────────────────────────────
  const playerResponse = extractPlayerResponse();
  if (!playerResponse) return; // silent exit — not a watch page or YT changed schema

  const captionUrl = extractCaptionUrl(playerResponse);
  if (!captionUrl) {
    // TODO: show "no captions available" state in sidebar
    return;
  }

  let chapters = extractChapters(playerResponse);

  // ── Step 2: fetch transcript ───────────────────────────────────────────────
  const segments = await fetchTranscript(captionUrl);
  // Inject the sidebar now so the user sees a loading state while Claude runs.
  // shadowRoot is reused for all subsequent updates.
  const shadowRoot = await injectSidebar();

  // ── Step 3: generate chapters if needed ───────────────────────────────────
  // If the video has no built-in chapters, ask Claude to create them.
  if (chapters.length === 0) {
    try {
      const response = await sendToBackground('GENERATE_CHAPTERS', { segments });
      chapters = response.chapters;
    } catch (err) {
      markChapterError(shadowRoot, 0, `Could not generate chapters: ${err.message}`);
      return;
    }
  }

  // ── Step 4: assign transcript segments to chapters ────────────────────────
  assignSegmentsToChapters(segments, chapters);

  // ── Step 5: render chapter skeletons (sidebar already injected in Step 2) ─
  renderChapterSkeleton(shadowRoot, chapters);

  // ── Step 6: summarize each chapter sequentially ───────────────────────────
  // Sequential (not parallel) so the user sees chapters fill in one by one,
  // and so we don't burst the API rate limit.
  for (let i = 0; i < chapters.length; i++) {
    const { title, startSeconds, segments: chapterSegments } = chapters[i];
    try {
      const result = await sendToBackground('SUMMARIZE_CHAPTER', { title, startSeconds, segments: chapterSegments });
      updateChapterCard(shadowRoot, i, result.summary, result.bullets);
    } catch (err) {
      markChapterError(shadowRoot, i, err.message);
    }
  }
}

// ─── Markdown export ──────────────────────────────────────────────────────────

// Called when the user clicks the Export button in the sidebar.
// Assembles all chapter summaries into a Markdown document and triggers a download.
function exportMarkdown(videoTitle, chapters) {
  const formatTs = s => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
  };

  const lines = [`# ${videoTitle}`, ''];

  for (const ch of chapters) {
    lines.push(`## ${ch.title} (${formatTs(ch.startSeconds)})`, '');
    if (ch.summary)  lines.push(ch.summary, '');
    if (ch.bullets?.length) {
      ch.bullets.forEach(b => lines.push(`- ${b}`));
      lines.push('');
    }
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const videoId = new URLSearchParams(location.search).get('v') || 'video';

  chrome.downloads.download({ url, filename: `keyframes-${videoId}.md` }, () => {
    URL.revokeObjectURL(url);
  });
}

// ─── SPA navigation ───────────────────────────────────────────────────────────

// YouTube is a single-page app. The content script persists across navigations,
// so we must detect URL changes and re-run the pipeline.
//
// 'yt-navigate-finish' is a custom event YouTube fires after the new page's
// data (including ytInitialPlayerResponse) is ready in the DOM.
let navDebounce = null;
document.addEventListener('yt-navigate-finish', () => {
  clearTimeout(navDebounce);
  navDebounce = setTimeout(init, 300);
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

init();
