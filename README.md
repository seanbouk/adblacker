# Ad Blacker

A Chrome extension that blacks out ads instead of blocking them. Ads load normally (avoiding anti-adblock detection), but are covered with solid black rectangles so you never see them.

## How It Works

Traditional ad blockers prevent ads from downloading, which triggers anti-adblock scripts on many websites. Ad Blacker takes a different approach:

1. **CSS layer** — Injects a stylesheet at `document_start` using EasyList cosmetic selectors. Matched elements get a `::before` pseudo-element overlay in solid black, applied before ads even render.
2. **JS layer** — After DOM ready, a MutationObserver catches dynamically-inserted ads and marks them. Click any black rectangle to reveal the original content.

Anti-adblock systems check whether ad scripts loaded and executed — they don't inspect CSS styling, so this approach flies under the radar.

## Features

- **13,000+ cosmetic filter selectors** from EasyList, with site-specific rules for 7,000+ domains
- **Click to reveal** — click any blacked ad to see it, with Re-black and Always Show buttons
- **Per-element whitelist** — "Always show" remembers your choice per domain across sessions
- **Per-site toggle** — disable Ad Blacker on specific sites via the popup
- **Global toggle** — turn everything on/off instantly
- **Auto-updating filters** — weekly background refresh from EasyList
- **Zero flash** — CSS injection at `document_start` means ads are black before you see them

## Installation

1. Clone or download this repository
2. Generate the filter list:
   ```
   node filters/parse-easylist.js
   ```
3. Open `chrome://extensions` in Chrome
4. Enable **Developer mode** (top right)
5. Click **Load unpacked** and select this folder

## Project Structure

```
manifest.json              MV3 extension config
background.js              Service worker: filters, whitelist, settings, badge
content.js                 Core: CSS injection, MutationObserver, click-to-reveal
content.css                Overlay and toolbar styles
popup/
  popup.html/css/js        Extension popup UI
filters/
  parse-easylist.js        Node script to fetch & parse EasyList
  easylist-cosmetic.json   Preprocessed cosmetic selectors (~0.7 MB)
icons/
  icon16/48/128.png        Extension icons
```

## Updating Filters

Filters auto-update weekly via `chrome.alarms`. To manually refresh:

```
node filters/parse-easylist.js
```

Then reload the extension in `chrome://extensions`.

## Known Limitations (v1)

- No Shadow DOM support (ads inside web components won't be blacked)
- No video ad handling
- `:has()` selectors from EasyList are skipped
- Whitelist fingerprints may stop matching after site redesigns (harmless)

## License

MIT
