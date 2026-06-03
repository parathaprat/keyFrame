// background/service-worker.js
// Thin relay — forwards messages from the content script to the native host
// and routes responses back. No API keys, no Claude logic, no caching here.

const HOST_NAME = 'com.keyframes.host';

let hostPort = null;
let pendingRequests = new Map(); // requestId → { resolve, reject }
let requestCounter = 0;

function getHostPort() {
  if (hostPort) return hostPort;

  hostPort = chrome.runtime.connectNative(HOST_NAME);

  hostPort.onMessage.addListener((message) => {
    const { requestId, ...rest } = message;
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    if (rest.ok === false) {
      pending.reject(new Error(rest.error));
    } else {
      pending.resolve(rest);
    }
  });

  hostPort.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message || 'Native host disconnected';
    hostPort = null;
    for (const [, pending] of pendingRequests) {
      pending.reject(new Error(reason));
    }
    pendingRequests.clear();
  });

  return hostPort;
}

function sendToHost(type, payload) {
  return new Promise((resolve, reject) => {
    const requestId = ++requestCounter;
    pendingRequests.set(requestId, { resolve, reject });
    try {
      getHostPort().postMessage({ requestId, type, ...payload });
    } catch (err) {
      pendingRequests.delete(requestId);
      reject(err);
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;

  if (type === 'FETCH_TRANSCRIPT') {
    sendToHost('FETCH_TRANSCRIPT', payload)
      .then(r => sendResponse({ ok: true, segments: r.segments }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (type === 'GENERATE_CHAPTERS') {
    sendToHost('GENERATE_CHAPTERS', payload)
      .then(r => sendResponse({ ok: true, chapters: r.chapters }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (type === 'SUMMARIZE_CHAPTER') {
    sendToHost('SUMMARIZE_CHAPTER', payload)
      .then(r => sendResponse({ ok: true, summary: r.summary, takeaways: r.takeaways, similarityScore: r.similarityScore, qualityScore: r.qualityScore }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
