// Shared by background.js and options.js (content scripts don't need it):
// which browser this is, and Firefox's consent for sending title names to
// OMDb. Chrome loads it with importScripts, Firefox lists it in the
// manifest before background.js, and options.html has a script tag for it.
//
// getBrowserInfo is Firefox-only and lives on its own browser.* namespace.
const FIREFOX = typeof browser !== 'undefined' && typeof browser.runtime?.getBrowserInfo === 'function';

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
