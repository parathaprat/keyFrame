# Icons

Place three PNG files here before loading the extension in Chrome:

- `icon16.png`  — 16×16 px  (favicon, extension bar)
- `icon48.png`  — 48×48 px  (Extensions management page)
- `icon128.png` — 128×128 px (Chrome Web Store listing)

Any simple PNG works for development. You can generate all three quickly with:

```bash
# ImageMagick — creates a solid dark-blue square as a placeholder
convert -size 16x16  xc:#1a1a2e icons/icon16.png
convert -size 48x48  xc:#1a1a2e icons/icon48.png
convert -size 128x128 xc:#1a1a2e icons/icon128.png
```
