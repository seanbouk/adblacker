// Ad Blacker — Content Script

(function () {
  'use strict';

  let adCount = 0;
  let selectors = [];
  let whitelistedSelectors = [];
  let selectorSet = null;
  let enabled = true;
  let styleEl = null;

  const domain = location.hostname;
  const OVERRIDE_PROPS = ['background', 'color', 'border-color', 'text-shadow', 'box-shadow'];

  // CSS-safe heuristic selectors (long enough to avoid false positives via substring matching)
  const HEURISTIC_SELECTORS = [
    '[class*="advert"]', '[id*="advert"]',
    '[class*="adslot"]', '[id*="adslot"]',
    '[class*="ad-slot"]', '[id*="ad-slot"]',
    '[class*="ad-unit"]', '[id*="ad-unit"]',
    '[class*="ad-container"]', '[id*="ad-container"]',
    '[class*="ad-wrapper"]', '[id*="ad-wrapper"]',
    '[class*="ad-banner"]', '[id*="ad-banner"]',
    '[class*="ad-box"]', '[id*="ad-box"]',
    '[class*="ad-space"]', '[id*="ad-space"]',
    '[class*="sponsor"]', '[id*="sponsor"]',
    '[class*="gpt-ad"]', '[id*="gpt-ad"]',
    '[class*="dfp-"]', '[id*="dfp-"]',
    '[class*="holding-ad"]',
    '[class*="advertisement"]', '[id*="advertisement"]',
  ];

  // JS-only: regex to match "ad" as a token bounded by delimiters (-_) or string edges.
  // Checked against individual class names / id, NOT the raw attribute string.
  // This avoids false positives like "image-lead__Ti3qQ" where CSS [class*="ad_"] would match.
  const AD_TOKEN_RE = /(^|[-_])ad([-_]|$)/i;

  // Broad CSS selector to find candidates for JS token matching
  const AD_CANDIDATE_SELECTOR = '[class*="ad"], [id*="ad"]';

  function hasAdToken(el) {
    for (const cls of el.classList) {
      if (AD_TOKEN_RE.test(cls)) return true;
    }
    if (el.id && AD_TOKEN_RE.test(el.id)) return true;
    return false;
  }

  const SEMANTIC_TAGS = new Set(['NAV', 'HEADER', 'MAIN', 'ARTICLE', 'FOOTER', 'SECTION']);

  function isLikelyAd(el) {
    // Skip semantic container tags unlikely to be ads
    if (SEMANTIC_TAGS.has(el.tagName)) return false;
    // Skip very small / invisible spacer elements
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return false;
    return true;
  }

  function overrideBlacking(el) {
    OVERRIDE_PROPS.forEach(prop => el.style.setProperty(prop, 'initial', 'important'));
    el.querySelectorAll('*').forEach(child => {
      child.style.setProperty('visibility', 'visible', 'important');
    });
  }

  // Initialize
  init();

  async function init() {
    // Check settings
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (!settings.enabled || settings.disabledSites?.includes(domain)) {
      enabled = false;
      return;
    }

    // Get whitelist
    const wl = await chrome.runtime.sendMessage({ type: 'WHITELIST_GET', domain });
    whitelistedSelectors = wl.selectors || [];

    // Get filters
    const response = await chrome.runtime.sendMessage({ type: 'GET_FILTERS', domain });
    selectors = response.selectors || [];

    // Build selector set for JS matching
    selectorSet = new Set(selectors);

    // Inject CSS layer (instant blacking — includes heuristic selectors)
    injectBlackingCSS();

    // When DOM is ready, apply JS layer
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDOMReady);
    } else {
      onDOMReady();
    }
  }

  function injectBlackingCSS() {
    // Build CSS rules, chunked into groups of 1000 selectors
    styleEl = document.createElement('style');
    styleEl.id = 'adblacker-injected';
    const chunks = [];

    for (let i = 0; i < selectors.length; i += 1000) {
      const chunk = selectors.slice(i, i + 1000);
      // Wrap each chunk in a rule — if a selector is invalid, only that chunk breaks
      const selectorGroup = chunk.join(',\n');
      const childGroup = chunk.map(s => s + ' *').join(',\n');
      chunks.push(`${selectorGroup} {
  background: #000 !important;
  color: transparent !important;
  border-color: transparent !important;
  text-shadow: none !important;
  box-shadow: none !important;
}
${childGroup} {
  visibility: hidden !important;
}`);
    }

    // Add heuristic selectors as an additional CSS chunk
    const heuristicGroup = HEURISTIC_SELECTORS.join(',\n');
    const heuristicChildGroup = HEURISTIC_SELECTORS.map(s => s + ' *').join(',\n');
    chunks.push(`${heuristicGroup} {
  background: #000 !important;
  color: transparent !important;
  border-color: transparent !important;
  text-shadow: none !important;
  box-shadow: none !important;
}
${heuristicChildGroup} {
  visibility: hidden !important;
}`);

    styleEl.textContent = chunks.join('\n');

    // Inject as early as possible
    const target = document.head || document.documentElement;
    if (target) {
      target.appendChild(styleEl);
    } else {
      // Ultra-early: wait for head
      const obs = new MutationObserver(() => {
        const t = document.head || document.documentElement;
        if (t) {
          t.appendChild(styleEl);
          obs.disconnect();
        }
      });
      obs.observe(document, { childList: true, subtree: true });
    }
  }

  function onDOMReady() {
    // Apply JS classes to existing elements
    applyToExisting();

    // Start MutationObserver
    startObserver();

    // Set up click-to-reveal
    setupClickToReveal();

    // Update badge
    updateBadge();
  }

  function applyToExisting() {
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (isWhitelisted(el)) continue;
          markElement(el);
        }
      } catch (e) {
        // Invalid selector — skip silently
      }
    }

    // Apply CSS-safe heuristic selectors with size/tag filtering
    for (const selector of HEURISTIC_SELECTORS) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (isWhitelisted(el)) continue;
          if (!isLikelyAd(el)) {
            overrideBlacking(el);
            continue;
          }
          markElement(el);
        }
      } catch (e) {
        // Invalid selector — skip silently
      }
    }

    // JS-only: match "ad" as a token in individual class names / id
    try {
      const candidates = document.querySelectorAll(AD_CANDIDATE_SELECTOR);
      for (const el of candidates) {
        if (el.classList.contains('adblacker-hidden')) continue;
        if (isWhitelisted(el)) continue;
        if (!hasAdToken(el)) continue;
        if (!isLikelyAd(el)) continue;
        markElement(el);
      }
    } catch (e) { /* skip */ }

    // Override injected CSS for whitelisted elements
    for (const sel of whitelistedSelectors) {
      try {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          overrideBlacking(el);
        }
      } catch (e) { /* invalid selector */ }
    }
  }

  function markElement(el) {
    if (el.classList.contains('adblacker-hidden')) return;
    el.classList.add('adblacker-hidden');
    el.dataset.adblacker = 'true';
    adCount++;
  }

  function isWhitelisted(el) {
    if (whitelistedSelectors.length === 0) return false;
    for (const sel of whitelistedSelectors) {
      try {
        if (el.matches(sel)) return true;
      } catch (e) {
        // Invalid selector
      }
    }
    return false;
  }

  // MutationObserver — watch for dynamically inserted ads
  function startObserver() {
    let pending = false;
    const observer = new MutationObserver((mutations) => {
      if (!enabled) return;
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        processMutations(mutations);
        pending = false;
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function processMutations(mutations) {
    const addedNodes = [];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          addedNodes.push(node);
        }
      }
    }

    if (addedNodes.length === 0) return;

    let newAds = 0;
    for (const node of addedNodes) {
      // Check the node itself
      for (const selector of selectors) {
        try {
          if (node.matches && node.matches(selector) && !isWhitelisted(node)) {
            markElement(node);
            newAds++;
            break;
          }
        } catch (e) { /* invalid selector */ }
      }

      // Check descendants
      for (const selector of selectors) {
        try {
          const matches = node.querySelectorAll ? node.querySelectorAll(selector) : [];
          for (const el of matches) {
            if (!isWhitelisted(el)) {
              markElement(el);
              newAds++;
            }
          }
        } catch (e) { /* invalid selector */ }
      }

      // CSS-safe heuristic: check the node itself
      for (const selector of HEURISTIC_SELECTORS) {
        try {
          if (node.matches && node.matches(selector) && !isWhitelisted(node)) {
            if (isLikelyAd(node)) {
              markElement(node);
              newAds++;
            } else {
              overrideBlacking(node);
            }
            break;
          }
        } catch (e) { /* invalid selector */ }
      }

      // CSS-safe heuristic: check descendants
      for (const selector of HEURISTIC_SELECTORS) {
        try {
          const matches = node.querySelectorAll ? node.querySelectorAll(selector) : [];
          for (const el of matches) {
            if (isWhitelisted(el)) continue;
            if (isLikelyAd(el)) {
              markElement(el);
              newAds++;
            } else {
              overrideBlacking(el);
            }
          }
        } catch (e) { /* invalid selector */ }
      }

      // JS-only token matching: check node and descendants
      if (node.matches && node.matches(AD_CANDIDATE_SELECTOR) && hasAdToken(node)) {
        if (!isWhitelisted(node) && isLikelyAd(node)) {
          markElement(node);
          newAds++;
        }
      }
      if (node.querySelectorAll) {
        try {
          const candidates = node.querySelectorAll(AD_CANDIDATE_SELECTOR);
          for (const el of candidates) {
            if (el.classList.contains('adblacker-hidden')) continue;
            if (!hasAdToken(el)) continue;
            if (isWhitelisted(el)) continue;
            if (!isLikelyAd(el)) continue;
            markElement(el);
            newAds++;
          }
        } catch (e) { /* skip */ }
      }
    }

    if (newAds > 0) {
      updateBadge();
    }
  }

  // Click-to-reveal: immediately whitelist and reveal
  function setupClickToReveal() {
    document.addEventListener('click', (e) => {
      if (!enabled) return;

      const adEl = e.target.closest('.adblacker-hidden');
      if (!adEl) return;

      e.preventDefault();
      e.stopPropagation();

      // Whitelist this element
      const fingerprint = getElementFingerprint(adEl);
      if (fingerprint) {
        chrome.runtime.sendMessage({ type: 'WHITELIST_ADD', domain, selector: fingerprint });
        whitelistedSelectors.push(fingerprint);
      }

      // Reveal it
      adEl.classList.remove('adblacker-hidden');
      overrideBlacking(adEl);
      adCount--;
      updateBadge();
    }, true);
  }

  // Build a CSS selector fingerprint for an element
  function getElementFingerprint(el) {
    if (el.id) {
      return '#' + CSS.escape(el.id);
    }

    const parts = [];
    let current = el;
    let depth = 0;

    while (current && current !== document.body && depth < 5) {
      let part = current.tagName.toLowerCase();

      if (current.id) {
        part = '#' + CSS.escape(current.id);
        parts.unshift(part);
        break;
      }

      if (current.classList.length > 0) {
        const classes = Array.from(current.classList)
          .filter(c => !c.startsWith('adblacker-'))
          .slice(0, 3)
          .map(c => '.' + CSS.escape(c))
          .join('');
        if (classes) part += classes;
      }

      // nth-child for specificity
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          part += ':nth-of-type(' + idx + ')';
        }
      }

      parts.unshift(part);
      current = current.parentElement;
      depth++;
    }

    return parts.join(' > ') || null;
  }

  function updateBadge() {
    chrome.runtime.sendMessage({ type: 'UPDATE_STATS', count: adCount }).catch(() => {});
  }
})();
