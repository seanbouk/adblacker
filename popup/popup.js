// Ad Blacker — Popup

document.addEventListener('DOMContentLoaded', async () => {
  const globalToggle = document.getElementById('globalToggle');
  const siteToggle = document.getElementById('siteToggle');
  const currentSiteEl = document.getElementById('currentSite');
  const adCountEl = document.getElementById('adCount');
  const filterCountEl = document.getElementById('filterCount');
  const whitelistInfo = document.getElementById('whitelistInfo');
  const clearWhitelistBtn = document.getElementById('clearWhitelist');

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let domain = '';
  try {
    domain = new URL(tab.url).hostname;
  } catch (e) {
    domain = '';
  }

  currentSiteEl.textContent = domain || 'N/A';

  // Load settings
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  globalToggle.checked = settings.enabled;
  siteToggle.checked = !settings.disabledSites?.includes(domain);

  if (!settings.enabled) {
    document.body.classList.add('disabled');
  }

  // Load stats
  const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
  filterCountEl.textContent = stats.filterCount.toLocaleString();

  // Get badge count for current tab
  if (tab.id) {
    const badgeText = await chrome.action.getBadgeText({ tabId: tab.id });
    adCountEl.textContent = badgeText || '0';
  }

  // Load whitelist
  if (domain) {
    const wl = await chrome.runtime.sendMessage({ type: 'WHITELIST_GET', domain });
    if (wl.selectors && wl.selectors.length > 0) {
      whitelistInfo.textContent = wl.selectors.length + ' element(s) whitelisted';
      clearWhitelistBtn.style.display = 'inline-block';
    }
  }

  // Global toggle
  globalToggle.addEventListener('change', async () => {
    settings.enabled = globalToggle.checked;
    await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings });
    document.body.classList.toggle('disabled', !settings.enabled);
    reloadTab(tab.id);
  });

  // Site toggle
  siteToggle.addEventListener('change', async () => {
    if (!domain) return;
    if (siteToggle.checked) {
      settings.disabledSites = (settings.disabledSites || []).filter(s => s !== domain);
    } else {
      if (!settings.disabledSites) settings.disabledSites = [];
      settings.disabledSites.push(domain);
    }
    await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings });
    reloadTab(tab.id);
  });

  // Clear whitelist
  clearWhitelistBtn.addEventListener('click', async () => {
    if (!domain) return;
    await chrome.runtime.sendMessage({ type: 'WHITELIST_CLEAR', domain });
    whitelistInfo.textContent = 'No whitelisted elements';
    clearWhitelistBtn.style.display = 'none';
    reloadTab(tab.id);
  });
});

function reloadTab(tabId) {
  if (tabId) {
    chrome.tabs.reload(tabId);
  }
}
