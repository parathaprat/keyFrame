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

// Shared state — written by init(), read by updateChapterCard and exportMarkdown
let currentChapters   = [];
let currentVideoTitle = '';

// ─── Phase 1 · Extraction ─────────────────────────────────────────────────────

// Parses ytInitialPlayerResponse out of the raw page HTML.
// Content scripts run in an isolated JS world and cannot access page-level
// variables directly, so we extract the JSON from the <script> tag text.
// Returns the parsed object, or null if not found.
function extractPlayerResponse() {
  try {
    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent;
      if (!text.includes('ytInitialPlayerResponse')) continue;

      const start = text.indexOf('ytInitialPlayerResponse');
      const brace = text.indexOf('{', start);
      if (brace === -1) continue;

      let depth = 0;
      let i = brace;
      for (; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }

      return JSON.parse(text.slice(brace, i + 1));
    }
    return null;
  } catch {
    return null;
  }
}

// Returns an array of {title, startSeconds} from the playerResponse chapters
// path, or an empty array if the video has no chapters.
function extractChapters(playerResponse) {
  // Try playerOverlays path first
  const overlayChapters = playerResponse
    ?.playerOverlays?.playerOverlayRenderer
    ?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer
    ?.playerBar?.multiMarkersPlayerBarRenderer
    ?.markersMap?.[0]?.value?.chapters;

  if (Array.isArray(overlayChapters) && overlayChapters.length > 0) {
    return overlayChapters.map(ch => ({
      title: ch.chapterRenderer.title.simpleText,
      startSeconds: ch.chapterRenderer.timeRangeStartMillis / 1000,
    }));
  }

  // Fallback: extract from ytInitialData horizontalCardListRenderer
  try {
    for (const script of document.querySelectorAll('script')) {
      if (!script.textContent.includes('ytInitialData')) continue;
      const match = script.textContent.match(/ytInitialData\s*=\s*({.+?});/s);
      if (!match) continue;
      const data = JSON.parse(match[1]);
      const panel = data?.engagementPanels?.find(p =>
        p?.engagementPanelSectionListRenderer?.panelIdentifier ===
        'engagement-panel-structured-description'
      );
      const rows = panel?.engagementPanelSectionListRenderer?.content
        ?.structuredDescriptionContentRenderer?.items;
      const cardList = rows?.find(r => r?.horizontalCardListRenderer);
      const cards = cardList?.horizontalCardListRenderer?.cards;
      if (!Array.isArray(cards) || cards.length === 0) continue;
      const chapters = cards.map(c => ({
        title: c?.macroMarkersListItemRenderer?.title?.simpleText,
        startSeconds: c?.macroMarkersListItemRenderer?.onTap?.watchEndpoint?.startTimeSeconds ?? 0,
      })).filter(c => c.title);
      if (chapters.length > 0) return chapters;
    }
  } catch(e) {}

  return [];
}

// Returns { baseUrl } for the best available caption track, or null.
// Priority: manual English → ASR English → any English variant → first.
function extractCaptionTrack(playerResponse) {
  const tracks = playerResponse
    ?.captions
    ?.playerCaptionsTracklistRenderer
    ?.captionTracks;

  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  const isEnglish = t => t.languageCode === 'en' || t.languageCode?.startsWith('en-');

  const track =
    tracks.find(t => isEnglish(t) && t.kind !== 'asr')  ?? // manual English
    tracks.find(t => isEnglish(t))                        ?? // ASR English (en, en-US …)
    tracks[0];                                               // anything

  return { baseUrl: track.baseUrl ?? null };
}

// Fetches captions via the service worker → local KeyFrames server.
async function fetchTranscript(videoId) {
  const result = await sendToBackground('FETCH_TRANSCRIPT_SERVER', { videoId, lang: 'en' });
  return result.segments.map(s => ({
    start: s.offset / 1000,
    dur:   s.duration / 1000,
    text:  s.text,
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

function fmtSecs(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

// Injects the KeyFrames sidebar into YouTube's #secondary column and returns
// the shadow root so subsequent functions can query into it safely.
// Shadow DOM prevents our CSS from leaking into YouTube's styles and vice versa.
async function injectSidebar() {
  // Remove stale sidebar from previous SPA navigation
  document.getElementById(SIDEBAR_ID)?.remove();

  const host = document.createElement('div');
  host.id = SIDEBAR_ID;
  const shadowRoot = host.attachShadow({ mode: 'open' });

  // Load CSS into the shadow root so our styles are fully isolated
  const cssText = await fetch(chrome.runtime.getURL('content/sidebar.css')).then(r => r.text());
  const style = document.createElement('style');
  style.textContent = cssText;
  shadowRoot.appendChild(style);

  // Initial shell — chapter list stays empty until renderChapterSkeleton runs
  const container = document.createElement('div');
  container.className = 'kf-sidebar';
  container.innerHTML = `
    <div class="kf-header">
      <span class="kf-title">KeyFrames</span>
      <button class="kf-export-btn" id="kf-export" disabled>Export Notes</button>
    </div>
    <div class="kf-status" id="kf-status">Analyzing transcript…</div>
    <div class="kf-chapter-list" id="kf-chapter-list"></div>
  `;
  shadowRoot.appendChild(container);

  shadowRoot.getElementById('kf-export').addEventListener('click', () => {
    exportMarkdown(currentVideoTitle, currentChapters);
  });

  // Wait up to 3 s for #secondary — it may not be painted yet at document_idle
  let secondary = null;
  for (let i = 0; i < 10; i++) {
    secondary = document.querySelector(SECONDARY_SEL);
    if (secondary) break;
    await new Promise(r => setTimeout(r, 300));
  }
  (secondary ?? document.body).prepend(host);
  return shadowRoot;
}

// Renders the chapter list into the shadow root.
// Each chapter card starts in a loading state; summaries are filled in
// progressively as SUMMARIZE_CHAPTER responses arrive.
function renderChapterSkeleton(shadowRoot, chapters) {
  const list   = shadowRoot.getElementById('kf-chapter-list');
  const status = shadowRoot.getElementById('kf-status');
  if (!list) return;

  status.textContent = `Summarizing ${chapters.length} chapter${chapters.length !== 1 ? 's' : ''}…`;
  list.innerHTML = '';

  chapters.forEach((chapter, index) => {
    const card = document.createElement('div');
    card.className = 'kf-chapter';
    card.dataset.index = index;

    const aiTag = chapter.aiGenerated ? '<span class="kf-ai-badge">AI</span>' : '';

    card.innerHTML = `
      <div class="kf-chapter-header">
        <button class="kf-timestamp" data-seconds="${chapter.startSeconds}">${fmtSecs(chapter.startSeconds)}</button>
        <span class="kf-chapter-title">${chapter.title}${aiTag}</span>
      </div>
      <div class="kf-chapter-body">
        <div class="kf-skeleton"></div>
        <div class="kf-skeleton kf-skeleton--short"></div>
        <div class="kf-skeleton kf-skeleton--shorter"></div>
      </div>
    `;

    card.querySelector('.kf-timestamp').addEventListener('click', () => {
      const video = document.querySelector(VIDEO_SEL);
      if (video) video.currentTime = chapter.startSeconds;
    });

    list.appendChild(card);
  });
}

// Updates a single chapter card in-place once its summary arrives.
function updateChapterCard(shadowRoot, index, summary, takeaways) {
  const card = shadowRoot.querySelector(`[data-index="${index}"]`);
  if (!card) return;

  // Persist onto the chapter object so exportMarkdown has the data
  if (currentChapters[index]) {
    currentChapters[index].summary   = summary;
    currentChapters[index].takeaways = takeaways;
  }

  const body = card.querySelector('.kf-chapter-body');
  body.innerHTML = `
    <p class="kf-summary">${summary}</p>
    <ul class="kf-takeaways">
      ${(takeaways || []).map(t => `<li>${t}</li>`).join('')}
    </ul>
  `;
  body.classList.add('kf-fade-in');
  card.dataset.done = 'true';

  // Enable export and update status once every card has been processed
  const total = shadowRoot.querySelectorAll('.kf-chapter').length;
  const done  = shadowRoot.querySelectorAll('[data-done]').length;
  if (done >= total) {
    shadowRoot.getElementById('kf-export').disabled = false;
    shadowRoot.getElementById('kf-status').textContent = `${total} chapter${total !== 1 ? 's' : ''} summarized`;
  }
}

// Renders an error state for a specific chapter card.
function markChapterError(shadowRoot, index, errorMessage) {
  const card = shadowRoot.querySelector(`[data-index="${index}"]`);
  if (!card) return;

  const body = card.querySelector('.kf-chapter-body');
  if (body) body.innerHTML = `<p class="kf-error">${errorMessage}</p>`;
  card.dataset.done = 'true';

  // Still check for completion so other succeeded cards can unlock export
  const total = shadowRoot.querySelectorAll('.kf-chapter').length;
  const done  = shadowRoot.querySelectorAll('[data-done]').length;
  if (done >= total) {
    const anySuccess = shadowRoot.querySelector('.kf-summary');
    if (anySuccess) shadowRoot.getElementById('kf-export').disabled = false;
    shadowRoot.getElementById('kf-status').textContent = 'Done (some chapters had errors)';
  }
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
  const videoId = new URLSearchParams(location.search).get('v') || '';

  // ── Step 1: wait for ytInitialPlayerResponse ───────────────────────────────
  let playerResponse = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    playerResponse = extractPlayerResponse();
    if (playerResponse) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!playerResponse) return;
  currentVideoTitle = document.title.replace(' - YouTube', '').trim();

  // ── Step 2: inject sidebar immediately so every subsequent error is visible ─
  const shadowRoot = await injectSidebar();
  const setStatus  = msg => { shadowRoot.getElementById('kf-status').textContent = msg; };

  let chapters = extractChapters(playerResponse);

  // ── Step 3: fetch transcript via local server ──────────────────────────────
  let segments;
  try {
    segments = await fetchTranscript(videoId);
  } catch (err) {
    setStatus(`Failed to load transcript: ${err.message}`);
    return;
  }

  if (segments.length === 0) {
    setStatus('No transcript found for this video.');
    return;
  }

  // ── Step 4: generate chapters if needed ────────────────────────────────────
  if (chapters.length === 0) {
    try {
      const response = await sendToBackground('GENERATE_CHAPTERS', { segments, videoId });
      chapters = response.chapters.map(ch => ({ ...ch, aiGenerated: true }));
    } catch (err) {
      setStatus(`Error: ${err.message}`);
      return;
    }
  }

  // ── Step 5: assign transcript segments to chapters ─────────────────────────
  assignSegmentsToChapters(segments, chapters);
  currentChapters = chapters;

  // ── Step 6: render chapter skeletons ───────────────────────────────────────
  renderChapterSkeleton(shadowRoot, chapters);

  // ── Step 7: summarize each chapter sequentially ────────────────────────────
  for (let i = 0; i < chapters.length; i++) {
    const { title, startSeconds, segments: chapterSegments } = chapters[i];
    try {
      const result = await sendToBackground('SUMMARIZE_CHAPTER', { title, startSeconds, segments: chapterSegments, chapterIndex: i, videoId });
      updateChapterCard(shadowRoot, i, result.summary, result.takeaways);
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
    if (ch.takeaways?.length) {
      ch.takeaways.forEach(b => lines.push(`- ${b}`));
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
