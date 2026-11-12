// Prints the Firefox manifest for the extension, made from the Chrome one
// (manifest.json stays the single source). Used by
// build-zip.ps1:  node firefox-manifest.mjs > manifest.json
//
// What differs in Firefox:
// - name: addons.mozilla.org refuses a package name over 45 characters
//   (its listing page allows 50), so the store name (Chrome's, 56) drops
//   HBO Max and says "&"; HBO Max stays in the summary and description.
// - background: an event page listing its scripts (the ones the Chrome
//   service worker loads with importScripts, in the same order, then
//   background.js itself) instead of a service worker; no "offscreen" permission (the build page goes in a frame of
//   the background page, see ensureOffscreen in background.js).
// - host permissions: Firefox treats every host permission as optional
//   (granted when the extension asks, revocable on about:addons), so the
//   Chrome manifest's optional_host_permissions join host_permissions
//   here; the catch-all https://*/* is what lets the user add an address
//   of their own (sites-list.js), asked for one address at a time.
// - browser_specific_settings: the add-on ID, Firefox 140 or later (the
//   first with the built-in data consent below), and data collection: none
//   by default; title names go to OMDb only after the user turns OMDb on
//   and allows "website content" when Firefox asks.
import { readFileSync } from 'node:fs';

const src = new URL('../manifest.json', import.meta.url);
const m = JSON.parse(readFileSync(src, 'utf8'));

m.name = 'IMDb Ratings on Netflix, Prime, Hulu & others';
m.background = { scripts: ['compat.js', 'sites-list.js', 'db.js', 'omdb.js', 'lookup.js', 'languages.js', 'refresh.js', 'build.js', 'background.js'] };
m.permissions = m.permissions.filter((p) => p !== 'offscreen');
m.host_permissions = m.host_permissions.concat(m.optional_host_permissions || []);
delete m.optional_host_permissions;
m.browser_specific_settings = {
  gecko: {
    id: 'show-imdb-ratings@lwolf12',
    strict_min_version: '140.0',
    data_collection_permissions: {
      required: ['none'],
      optional: ['websiteContent'],
    },
  },
};

process.stdout.write(JSON.stringify(m, null, 2) + '\n');
