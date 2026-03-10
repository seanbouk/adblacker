#!/usr/bin/env node

// Ad Blacker — EasyList Cosmetic Filter Parser
// Fetches EasyList, extracts cosmetic (##) selectors, outputs JSON

const https = require('https');
const fs = require('fs');
const path = require('path');

const EASYLIST_URL = 'https://easylist.to/easylist/easylist.txt';
const OUTPUT_PATH = path.join(__dirname, 'easylist-cosmetic.json');

// Pseudo-classes we skip (non-standard or unsupported in CSS)
const SKIP_PSEUDO = [
  ':has(', ':-abp-', ':matches-css(', ':matches-attr(',
  ':xpath(', ':nth-ancestor(', ':upward(', ':remove(',
  ':matches-path(', ':min-text-length(', ':watch-attr(',
  ':if(', ':if-not(', ':contains('
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'AdBlacker/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function isValidSelector(selector) {
  if (!selector || selector.length === 0) return false;
  if (selector.length > 500) return false;
  if (selector.includes('{') || selector.includes('}')) return false;
  // Skip procedural/extended selectors
  if (SKIP_PSEUDO.some(p => selector.includes(p))) return false;
  return true;
}

async function main() {
  console.log('Fetching EasyList...');
  const text = await fetch(EASYLIST_URL);
  const lines = text.split('\n');

  console.log(`Processing ${lines.length} lines...`);

  const generic = [];
  const siteSpecific = {};
  const exceptions = {};
  let skipped = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Site-specific exception: domain#@#selector
    const exMatch = line.match(/^([^#]+)#@#(.+)$/);
    if (exMatch) {
      const domains = exMatch[1].split(',');
      const selector = exMatch[2].trim();
      if (!isValidSelector(selector)) { skipped++; continue; }
      for (const d of domains) {
        const domain = d.trim();
        if (domain.startsWith('~')) continue;
        if (!exceptions[domain]) exceptions[domain] = [];
        exceptions[domain].push(selector);
      }
      continue;
    }

    // Site-specific cosmetic: domain##selector
    const siteMatch = line.match(/^([^#]+)##(.+)$/);
    if (siteMatch && !line.startsWith('##')) {
      const domains = siteMatch[1].split(',');
      const selector = siteMatch[2].trim();
      if (!isValidSelector(selector)) { skipped++; continue; }
      for (const d of domains) {
        const domain = d.trim();
        if (domain.startsWith('~')) continue;
        if (!siteSpecific[domain]) siteSpecific[domain] = [];
        siteSpecific[domain].push(selector);
      }
      continue;
    }

    // Generic cosmetic: ##selector
    if (line.startsWith('##')) {
      const selector = line.slice(2).trim();
      if (!isValidSelector(selector)) { skipped++; continue; }
      generic.push(selector);
    }
  }

  const result = { generic, siteSpecific, exceptions };

  const json = JSON.stringify(result);
  fs.writeFileSync(OUTPUT_PATH, json, 'utf8');

  const sizeMB = (Buffer.byteLength(json, 'utf8') / 1024 / 1024).toFixed(2);
  console.log(`\nDone!`);
  console.log(`  Generic selectors: ${generic.length}`);
  console.log(`  Site-specific domains: ${Object.keys(siteSpecific).length}`);
  console.log(`  Exception domains: ${Object.keys(exceptions).length}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Output: ${OUTPUT_PATH} (${sizeMB} MB)`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
