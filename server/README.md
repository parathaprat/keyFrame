# KeyFrames Server

Required for transcript fetching.

## Setup
cd server
npm install
node index.js

Server runs on http://localhost:3000

## Why this exists
YouTube's timedtext API requires session authentication that isn't
available in Chrome extension contexts. This lightweight proxy runs
locally and handles transcript fetching on behalf of the extension.
