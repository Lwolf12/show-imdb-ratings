// Shared by the background scripts and options.js (content scripts don't
// need it): which browser this is, Firefox's consent for sending title
// names to OMDb, and a day in milliseconds. Chrome loads it with
// importScripts, Firefox lists it first in the manifest's background
// scripts, and options.html has a script tag for it.
//
// getBrowserInfo is Firefox-only and lives on its own browser.* namespace.
const FIREFOX = typeof browser !== 'undefined' && typeof browser.runtime?.getBrowserInfo === 'function';

const DAY_MS = 24 * 60 * 60 * 1000;

// Firefox asks the user before data leaves the device: the manifest declares
// the optional data collection "websiteContent" (store/firefox-manifest.mjs),
// which the settings page requests when OMDb is turned on, saved or tested.
// Until it is granted, nothing goes to OMDb. Chrome has no such permission.

// Whether OMDb lookups are allowed (always in Chrome). Fails closed: if
// Firefox lists no data-collection grants, or the query fails, the answer is
// no. Cached until Firefox reports a permission change, since the background
// asks on every lookup.
let omdbConsentCache = null;

async function omdbConsent() {
  if (!FIREFOX) return true;
  if (omdbConsentCache == null) {
    omdbConsentCache = browser.permissions.getAll()
      .then((all) => Array.isArray(all.data_collection) && all.data_collection.includes('websiteContent'))
      .catch(() => false);
  }
  return omdbConsentCache;
}

if (FIREFOX) {
  const forget = () => { omdbConsentCache = null; };
  browser.permissions.onAdded.addListener(forget);
  browser.permissions.onRemoved.addListener(forget);
}

// Asks Firefox for that consent: a prompt the first time, an immediate yes
// once granted. Must be a click handler's first await, since Firefox only
// asks during the click. Chrome: always yes.
async function askOmdbConsent() {
  if (!FIREFOX) return true;
  omdbConsentCache = null;
  return browser.permissions.request({ data_collection: ['websiteContent'] }).catch(() => false);
}

// Access to datasets.imdbws.com, where the build fetches IMDb's files.
// Chrome grants the manifest's hosts at install; Firefox treats them as
// the user's to give and withdraw (about:addons, Permissions), and a
// temporary add-on starts without them, so a build would fail with a
// bare NetworkError. Asked before every build the settings page starts,
// as the click handler's first await: a prompt the first time, an
// immediate yes once granted. Chrome: always yes. The pattern is the
// manifest's own: Firefox grants exactly what it declares and refuses
// anything broader.
const IMDB_ORIGINS = (chrome.runtime.getManifest().host_permissions || []).filter((p) => p.includes('datasets.imdbws.com'));

async function askImdbAccess() {
  if (!FIREFOX) return true;
  return browser.permissions.request({ origins: IMDB_ORIGINS }).catch(() => false);
}
