// Prints the Firefox manifest for the extension, made from the Chrome one
// (manifest.json stays the single source). Used by
// build-zip.ps1:  node firefox-manifest.mjs > manifest.json
//
// What differs in Firefox:
// - background: an event page listing its scripts (compat.js and db.js first, which the
//   Chrome service worker loads with importScripts) instead of a service
//   worker; no "offscreen" permission (the build page goes in a frame of
//   the background page, see ensureOffscreen in background.js).
// - browser_specific_settings: the add-on ID, Firefox 140 or later (the
//   first with the built-in data consent below), and data collection: none
//   by default; title names go to OMDb only after the user turns OMDb on
//   and allows "website content" when Firefox asks.
import { readFileSync } from 'node:fs';

const src = new URL('../manifest.json', import.meta.url);
const m = JSON.parse(readFileSync(src, 'utf8'));

m.background = { scripts: ['compat.js', 'db.js', 'background.js'] };
m.permissions = m.permissions.filter((p) => p !== 'offscreen');
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
