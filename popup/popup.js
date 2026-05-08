// popup/popup.js

const apiKeyInput = document.getElementById('api-key');
const keyPreview  = document.getElementById('key-preview');
const saveBtn     = document.getElementById('btn-save');
const statusMsg   = document.getElementById('status-msg');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showStatus(msg, isError = false) {
  statusMsg.textContent = msg;
  statusMsg.className = isError ? 'status-msg error' : 'status-msg';
  if (!isError) setTimeout(() => { statusMsg.textContent = ''; }, 2500);
}

function maskKey(key) {
  return `${key.slice(0, 14)}…${key.slice(-4)}`;
}

// ─── On open: reflect stored key state ────────────────────────────────────────

chrome.storage.local.get('anthropicApiKey', result => {
  if (result.anthropicApiKey) {
    keyPreview.textContent = maskKey(result.anthropicApiKey);
    apiKeyInput.placeholder = '••••••••••••••••';
  }
});

// ─── Save ─────────────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
  const val = apiKeyInput.value.trim();

  if (!val) {
    showStatus('Please enter an API key.', true);
    return;
  }

  if (!val.startsWith('sk-ant-')) {
    showStatus('Key must start with sk-ant-', true);
    return;
  }

  chrome.storage.local.set({ anthropicApiKey: val }, () => {
    keyPreview.textContent   = maskKey(val);
    apiKeyInput.value        = '';
    apiKeyInput.placeholder  = '••••••••••••••••';
    showStatus('Key saved ✓');
  });
});
