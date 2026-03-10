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

    if (selectors.length === 0) return;

    // Build selector set for JS matching
    selectorSet = new Set(selectors);

    // Inject CSS layer (instant blacking)
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
  }

  function markElement(el) {
    if (el.classList.contains('adblacker-hidden') || el.classList.contains('adblacker-revealed')) return;
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
    }

    if (newAds > 0) {
      updateBadge();
    }
  }

  // Click-to-reveal
  function setupClickToReveal() {
    document.addEventListener('click', (e) => {
      if (!enabled) return;

      // Check if clicked element or ancestor is an adblacker-hidden element
      const adEl = e.target.closest('.adblacker-hidden');
      if (!adEl) return;

      e.preventDefault();
      e.stopPropagation();
      revealElement(adEl);
    }, true); // Capture phase
  }

  function revealElement(el) {
    el.classList.remove('adblacker-hidden');
    el.classList.add('adblacker-revealed');

    // Remove existing toolbar if any
    const existing = el.querySelector('.adblacker-toolbar');
    if (existing) existing.remove();

    // Create toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'adblacker-toolbar';

    const reblackBtn = document.createElement('button');
    reblackBtn.className = 'adblacker-btn-reblack';
    reblackBtn.textContent = '\u2715 Re-black';
    reblackBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toolbar.remove();
      el.classList.remove('adblacker-revealed');
      el.classList.add('adblacker-hidden');
    });

    const whitelistBtn = document.createElement('button');
    whitelistBtn.className = 'adblacker-btn-whitelist';
    whitelistBtn.textContent = '\u2713 Always show';
    whitelistBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fingerprint = getElementFingerprint(el);
      if (fingerprint) {
        chrome.runtime.sendMessage({
          type: 'WHITELIST_ADD',
          domain,
          selector: fingerprint
        });
        whitelistedSelectors.push(fingerprint);
      }
      toolbar.remove();
      el.classList.remove('adblacker-revealed');
      adCount--;
      updateBadge();
    });

    toolbar.appendChild(reblackBtn);
    toolbar.appendChild(whitelistBtn);

    el.appendChild(toolbar);
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
          part += ':nth-child(' + idx + ')';
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
