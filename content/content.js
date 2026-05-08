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
  // TODO:
  //   Iterate document.querySelectorAll('script') looking for a textContent
  //   that contains 'ytInitialPlayerResponse'. Extract the JSON value with a
  //   regex, then JSON.parse() it. Wrap in try/catch; return null on failure.
}

// Returns an array of {title, startSeconds} from the playerResponse chapters
// path, or an empty array if the video has no chapters.
function extractChapters(playerResponse) {
  // TODO:
  //   Safe-navigate to:
  //     playerResponse
  //       .playerOverlays
  //       .playerOverlayRenderer
  //       .decoratedPlayerBarRenderer
  //       .decoratedPlayerBarRenderer
  //       .playerBar
  //       .multiMarkersPlayerBarRenderer
  //       .markersMap[0].value.chapters
  //   Map each entry:
  //     { title: chapterRenderer.title.simpleText,
  //       startSeconds: chapterRenderer.timeRangeStartMillis / 1000 }
  //   Return [] if path doesn't exist or array is empty.
}

// Returns the URL string for the first English caption track, or null.
function extractCaptionUrl(playerResponse) {
  // TODO:
  //   Safe-navigate to:
  //     playerResponse.captions
  //       .playerCaptionsTracklistRenderer.captionTracks
  //   Prefer languageCode === 'en'; fall back to [0].
  //   Return track.baseUrl, or null if captions unavailable.
}

// Fetches the caption XML from YouTube and returns parsed segments.
// Returns [{start: number, dur: number, text: string}].
async function fetchTranscript(captionUrl) {
  // TODO:
  //   fetch(captionUrl)
  //   Parse response XML with DOMParser
  //   Map <text start dur> elements → objects
  //   Decode HTML entities in text content (YouTube encodes & → &amp; etc.)
}

// Merges transcript segments into chapters by assigning each segment to the
// chapter whose startSeconds is closest without going over.
// Mutates chapters in place, adding a `segments` array to each.
function assignSegmentsToChapters(segments, chapters) {
  // TODO:
  //   Sort chapters by startSeconds ascending.
  //   For each segment, binary-search (or linear scan) to find the right bucket.
  //   chapters[i].segments = [...]
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
  // TODO: fetch and parse transcript; show sidebar with loading state early

  // ── Step 3: generate chapters if needed ───────────────────────────────────
  // If the video has no built-in chapters, ask Claude to create them.
  if (chapters.length === 0) {
    // TODO:
    //   const response = await sendToBackground('GENERATE_CHAPTERS', { transcript })
    //   chapters = response.chapters
  }

  // ── Step 4: assign transcript segments to chapters ────────────────────────
  // TODO: assignSegmentsToChapters(segments, chapters)

  // ── Step 5: inject sidebar and render skeletons ───────────────────────────
  const shadowRoot = await injectSidebar();
  // TODO: renderChapterSkeleton(shadowRoot, chapters)

  // ── Step 6: summarize each chapter sequentially ───────────────────────────
  // Sequential (not parallel) so the user sees chapters fill in one by one,
  // and so we don't burst the API rate limit.
  for (let i = 0; i < chapters.length; i++) {
    const { title, startSeconds, segments } = chapters[i];
    try {
      const result = await sendToBackground('SUMMARIZE_CHAPTER', { title, startSeconds, segments });
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
  // TODO:
  //   Build a string:
  //     # {videoTitle}
  //     ## {chapter.title} ({timestamp})
  //     {chapter.summary}
  //     - bullet 1
  //     ...
  //   Create a Blob, a temporary object URL, and call chrome.downloads.download()
}

// ─── SPA navigation ───────────────────────────────────────────────────────────

// YouTube is a single-page app. The content script persists across navigations,
// so we must detect URL changes and re-run the pipeline.
//
// 'yt-navigate-finish' is a custom event YouTube fires after the new page's
// data (including ytInitialPlayerResponse) is ready in the DOM.
document.addEventListener('yt-navigate-finish', () => {
  // TODO: small debounce (~300ms) then call init()
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

init();
