# KeyFrames v2 Setup

## Prerequisites
- Node.js 18+
- Chrome browser

## First-time Setup (3 steps)

### Step 1: Load the extension
1. Open `chrome://extensions`
2. Enable Developer mode (top right toggle)
3. Click "Load unpacked" → select this project folder
4. Copy the Extension ID shown under the KeyFrames card

### Step 2: Save your Extension ID
Create a file called `.extension-id` inside the `host/` folder and paste
your Extension ID as the only content:

```
abcdefghijklmnopqrstuvwxyzabcdef
```

### Step 3: Install the native host
```bash
chmod +x host/install.sh
./host/install.sh
```

Then reload the extension: `chrome://extensions` → click the reload icon on KeyFrames.

## Environment Variables
Your `.env` file must contain:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## Using KeyFrames
Navigate to any YouTube video. The sidebar appears automatically on the right side.
No API key entry required — keys are read directly from `.env` by the native host.
