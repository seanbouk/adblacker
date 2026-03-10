// Ad Blacker — Background Service Worker

const FILTER_UPDATE_ALARM = 'adblacker-filter-update';
const FILTER_UPDATE_INTERVAL_MINUTES = 7 * 24 * 60; // Weekly

// On install: load bundled filters, set up alarm
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const resp = await fetch(chrome.runtime.getURL('filters/easylist-cosmetic.json'));
    const filters = await resp.json();
    await chrome.storage.local.set({ filters });
    console.log('[Ad Blacker] Loaded filters:', filters.generic.length, 'generic,',
      Object.keys(filters.siteSpecific).length, 'site-specific domains');
  } catch (e) {
    console.error('[Ad Blacker] Failed to load bundled filters:', e);
  }

  // Default settings
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) {
    await chrome.storage.local.set({
      settings: {
        enabled: true,
        disabledSites: []
      }
    });
  }

  // Weekly filter update alarm
  chrome.alarms.create(FILTER_UPDATE_ALARM, {
    periodInMinutes: FILTER_UPDATE_INTERVAL_MINUTES
  });
});

// Message handler
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'GET_FILTERS':
      return await getFiltersForDomain(msg.domain);

    case 'GET_SETTINGS':
      return await getSettings();

    case 'SET_SETTINGS':
      await chrome.storage.local.set({ settings: msg.settings });
      return { ok: true };

    case 'WHITELIST_ADD':
      return await addToWhitelist(msg.domain, msg.selector);

    case 'WHITELIST_GET':
      return await getWhitelist(msg.domain);

    case 'WHITELIST_CLEAR':
      return await clearWhitelist(msg.domain);

    case 'UPDATE_STATS':
      await updateBadge(msg.count, sender.tab?.id);
      return { ok: true };

    case 'GET_STATS':
      return await getStats();

    default:
      return { error: 'Unknown message type' };
  }
}

async function getFiltersForDomain(domain) {
  const { filters } = await chrome.storage.local.get('filters');
  if (!filters) return { selectors: [] };

  const selectors = [...filters.generic];

  // Add site-specific selectors
  if (filters.siteSpecific) {
    for (const [pattern, sels] of Object.entries(filters.siteSpecific)) {
      if (domainMatches(domain, pattern)) {
        selectors.push(...sels);
      }
    }
  }

  // Remove exceptions for this domain
  if (filters.exceptions) {
    const exceptionSet = new Set();
    for (const [pattern, sels] of Object.entries(filters.exceptions)) {
      if (domainMatches(domain, pattern)) {
        sels.forEach(s => exceptionSet.add(s));
      }
    }
    if (exceptionSet.size > 0) {
      return { selectors: selectors.filter(s => !exceptionSet.has(s)) };
    }
  }

  return { selectors };
}

function domainMatches(pageDomain, filterPattern) {
  if (pageDomain === filterPattern) return true;
  if (pageDomain.endsWith('.' + filterPattern)) return true;
  return false;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || { enabled: true, disabledSites: [] };
}

async function addToWhitelist(domain, selector) {
  const key = 'whitelist_' + domain;
  const data = await chrome.storage.local.get(key);
  const list = data[key] || [];
  if (!list.includes(selector)) {
    list.push(selector);
    await chrome.storage.local.set({ [key]: list });
  }
  return { ok: true };
}

async function getWhitelist(domain) {
  const key = 'whitelist_' + domain;
  const data = await chrome.storage.local.get(key);
  return { selectors: data[key] || [] };
}

async function clearWhitelist(domain) {
  const key = 'whitelist_' + domain;
  await chrome.storage.local.remove(key);
  return { ok: true };
}

async function updateBadge(count, tabId) {
  const text = count > 0 ? String(count) : '';
  if (tabId) {
    await chrome.action.setBadgeText({ text, tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#222', tabId });
  }
}

async function getStats() {
  const { filters } = await chrome.storage.local.get('filters');
  const filterCount = filters ? filters.generic.length : 0;
  const siteSpecificCount = filters?.siteSpecific ? Object.keys(filters.siteSpecific).length : 0;
  return { filterCount, siteSpecificCount };
}

// Weekly filter update
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== FILTER_UPDATE_ALARM) return;

  try {
    const response = await fetch('https://easylist.to/easylist/easylist.txt');
    const text = await response.text();
    const filters = parseEasyList(text);
    await chrome.storage.local.set({ filters });
    console.log('[Ad Blacker] Filters updated:', filters.generic.length, 'generic selectors');
  } catch (e) {
    console.error('[Ad Blacker] Filter update failed:', e);
  }
});

// Inline parser for background updates (mirrors parse-easylist.js logic)
function parseEasyList(text) {
  const generic = [];
  const siteSpecific = {};
  const exceptions = {};

  const SKIP_PSEUDO = [':has(', ':-abp-', ':matches-css(', ':matches-attr(', ':xpath(', ':nth-ancestor(', ':upward(', ':remove('];

  const lines = text.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Exception rules
    if (line.startsWith('#@#')) {
      continue; // Global exceptions — skip for simplicity
    }

    // Site-specific exception
    const exMatch = line.match(/^([^#]+)#@#(.+)$/);
    if (exMatch) {
      const domains = exMatch[1].split(',');
      const selector = exMatch[2].trim();
      if (SKIP_PSEUDO.some(p => selector.includes(p))) continue;
      if (!isValidSelector(selector)) continue;
      for (const d of domains) {
        const domain = d.trim();
        if (domain.startsWith('~')) continue;
        if (!exceptions[domain]) exceptions[domain] = [];
        exceptions[domain].push(selector);
      }
      continue;
    }

    // Site-specific cosmetic
    const siteMatch = line.match(/^([^#]+)##(.+)$/);
    if (siteMatch && !line.startsWith('##')) {
      const domains = siteMatch[1].split(',');
      const selector = siteMatch[2].trim();
      if (SKIP_PSEUDO.some(p => selector.includes(p))) continue;
      if (!isValidSelector(selector)) continue;
      for (const d of domains) {
        const domain = d.trim();
        if (domain.startsWith('~')) continue;
        if (!siteSpecific[domain]) siteSpecific[domain] = [];
        siteSpecific[domain].push(selector);
      }
      continue;
    }

    // Generic cosmetic
    if (line.startsWith('##')) {
      const selector = line.slice(2).trim();
      if (SKIP_PSEUDO.some(p => selector.includes(p))) continue;
      if (!isValidSelector(selector)) continue;
      generic.push(selector);
    }
  }

  return { generic, siteSpecific, exceptions };
}

function isValidSelector(selector) {
  if (!selector || selector.length === 0) return false;
  if (selector.length > 500) return false;
  // Basic sanity checks
  if (selector.includes('{') || selector.includes('}')) return false;
  return true;
}
