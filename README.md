# Ad Blacker

A Chrome extension that blacks out ads instead of blocking them. Ads load normally (avoiding anti-adblock detection), but are covered with solid black rectangles so you never see them.

## How It Works

Traditional ad blockers prevent ads from downloading, which triggers anti-adblock scripts on many websites. Ad Blacker takes a different approach:

1. **CSS layer** — Injects a stylesheet at `document_start` using EasyList cosmetic selectors. Matched elements get a black background with hidden children, applied before ads even render.
2. **Heuristic detection** — Catches self-hosted ads that EasyList misses by matching common ad-related naming patterns in class/id attributes (e.g. `ad-container`, `holding-ad`, `sponsor`). Short "ad" token patterns use JS word-boundary matching to avoid false positives on words like "lead" or "bread".
3. **JS layer** — After DOM ready, a MutationObserver catches dynamically-inserted ads and marks them. Click any black rectangle to whitelist it and reveal the original content.

Anti-adblock systems check whether ad scripts loaded and executed — they don't inspect CSS styling, so this approach flies under the radar.

## Features

- **13,000+ cosmetic filter selectors** from EasyList, with site-specific rules for 7,000+ domains
- **Heuristic ad detection** — catches self-hosted ads using common naming patterns (`ad-*`, `*-ad`, `sponsor`, `dfp-*`, etc.) with word-boundary–safe matching
- **Click to whitelist** — click any blacked ad to reveal it and whitelist it permanently for that site
- **Whitelist management** — manage whitelisted elements per site from the popup
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
content.js                 Core: CSS injection, MutationObserver, click-to-whitelist
content.css                Overlay styles
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
