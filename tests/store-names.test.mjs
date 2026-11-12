// The extension's name in each store: Chrome's from manifest.json (75
// characters at most), Firefox's from store/firefox-manifest.mjs (45: the
// package check on addons.mozilla.org refuses more, though its listing
// page allows 50). Both name at most four services, the most that has
// passed review (store/LISTING.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const chrome = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const firefox = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('store/firefox-manifest.mjs', root))], { encoding: 'utf8' }));
const SERVICES = ['Netflix', 'Prime', 'Hulu', 'HBO', 'Disney', 'Apple', 'Paramount', 'Tubi', 'Letterboxd'];
const named = (s) => SERVICES.filter((x) => s.includes(x)).length;

test('the Chrome name fits the Chrome Web Store and names at most four services', () => {
  assert.ok(chrome.name.length <= 75, chrome.name.length + ' characters');
  assert.ok(named(chrome.name) <= 4);
});

test('the Firefox name fits addons.mozilla.org and names at most four services', () => {
  assert.ok(firefox.name.length <= 45, firefox.name.length + ' characters');
  assert.ok(named(firefox.name) <= 4);
});

test('both names lead with IMDb Ratings on Netflix, for store search', () => {
  assert.match(chrome.name, /^IMDb Ratings on Netflix\b/);
  assert.match(firefox.name, /^IMDb Ratings on Netflix\b/);
});
