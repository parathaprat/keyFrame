#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_JS="$SCRIPT_DIR/host.js"
EXT_ID_FILE="$SCRIPT_DIR/.extension-id"
MANIFEST_TARGET="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.keyframes.host.json"

# Wrapper lives in ~/Library so Chrome can always execute it (Desktop has sandbox restrictions)
WRAPPER_DIR="$HOME/Library/Application Support/KeyFrames"
WRAPPER="$WRAPPER_DIR/keyframes-host"

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is not installed." >&2
  echo "Install it from https://nodejs.org or via Homebrew: brew install node" >&2
  exit 1
fi

NODE_BIN="$(command -v node)"
echo "Using Node.js at: $NODE_BIN ($($NODE_BIN --version))"

echo "Installing npm dependencies..."
cd "$SCRIPT_DIR"
npm install

# Check for extension ID
if [ ! -f "$EXT_ID_FILE" ]; then
  echo ""
  echo "Error: host/.extension-id not found." >&2
  echo ""
  echo "To get your Extension ID:" >&2
  echo "  1. Open chrome://extensions in Chrome" >&2
  echo "  2. Enable Developer mode (top-right toggle)" >&2
  echo "  3. Click 'Load unpacked' and select this project folder" >&2
  echo "  4. Copy the ID shown under the KeyFrames card" >&2
  echo "  5. Create the file host/.extension-id with that ID as its only content" >&2
  echo ""
  exit 1
fi

EXTENSION_ID="$(tr -d '[:space:]' < "$EXT_ID_FILE")"
if [ -z "$EXTENSION_ID" ]; then
  echo "Error: host/.extension-id is empty. Paste your Extension ID into that file." >&2
  exit 1
fi

# Make host.js executable
chmod +x "$HOST_JS"

# Create wrapper script in ~/Library (Chrome can always exec files here)
mkdir -p "$WRAPPER_DIR"
cat > "$WRAPPER" <<WRAPPER_EOF
#!/bin/bash
exec "$NODE_BIN" "$HOST_JS"
WRAPPER_EOF
chmod +x "$WRAPPER"

# Write the native messaging host manifest pointing to the wrapper
mkdir -p "$(dirname "$MANIFEST_TARGET")"
cat > "$MANIFEST_TARGET" <<EOF
{
  "name": "com.keyframes.host",
  "description": "KeyFrames Native Messaging Host",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

echo ""
echo "KeyFrames host installed. Reload the extension in chrome://extensions."
echo "  Node binary : $NODE_BIN"
echo "  Host script : $HOST_JS"
echo "  Wrapper     : $WRAPPER"
echo "  Extension ID: $EXTENSION_ID"
echo "  Manifest    : $MANIFEST_TARGET"
