// popup/popup.js
//
// Handles the browser-action popup UI.
// Responsibilities:
//   1. Read the stored API key and show whether one is set
//   2. Let the user save a new API key to chrome.storage.local
//   3. Query the active tab to show the current sidebar status

// ─── Elements ─────────────────────────────────────────────────────────────────

const apiKeyInput  = document.getElementById('api-key-input');
const saveKeyBtn   = document.getElementById('save-key-btn');
const keyStatus    = document.getElementById('key-status');
const statusSection = document.getElementById('status-section');

// ─── API key ──────────────────────────────────────────────────────────────────

// On popup open: check storage and reflect current state in the UI.
async function loadKeyState() {
  // TODO:
  //   chrome.storage.local.get('anthropicApiKey')
  //   If set: show "••••••••" masked hint + "Key saved ✓" in keyStatus
  //   If not set: leave input empty, show "No key saved" in keyStatus
}

// Save the key the user typed, then update the status label.
async function saveApiKey() {
  // TODO:
  //   Trim apiKeyInput.value; validate it starts with 'sk-ant-'
  //   chrome.storage.local.set({ anthropicApiKey: value })
  //   Update keyStatus to "Key saved ✓"
  //   Clear the input so the key isn't visible in plaintext
}

saveKeyBtn.addEventListener('click', saveApiKey);

// ─── Tab status ───────────────────────────────────────────────────────────────

// Show a brief status line so the user knows what the extension is doing on
// the current tab (e.g. "Summarizing chapter 3 of 6…", "6 chapters ready").
async function loadTabStatus() {
  // TODO:
  //   chrome.tabs.query({ active: true, currentWindow: true })
  //   If tab URL does not match youtube.com/watch: show "Open a YouTube video"
  //   Otherwise: send a GET_STATUS message to the content script and render
  //   the response (content.js will need a corresponding message handler)
}

// ─── Init ─────────────────────────────────────────────────────────────────────

loadKeyState();
loadTabStatus();
