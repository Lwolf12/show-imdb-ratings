// Service worker: looks up IMDb ratings, first in the local database that
// the extension builds in the browser from IMDb's data dumps (db.js,
// builder.js), then through the OMDb API for titles the database lacks, and
// keeps a permanent store of answers in chrome.storage.local.
//
// This file is the shell: the event listeners, the message router, the
// settings window and the status report for the settings page (usage).
// The work is in omdb.js (the OMDb client), lookup.js (the answers),
// languages.js (titles in other languages), refresh.js (the schedule) and
// build.js (the database build): one global scope, loaded in that order
// after compat.js and db.js (the importScripts line below; Firefox lists
// them in the manifest, store/firefox-manifest.mjs).
//
// The same file is Firefox's background page (see FIREFOX, from compat.js, below).
//
// Also owns the database build: it runs in a hidden offscreen page
// (offscreen.html -> build-worker.js), started by the Update button on the
// settings panel (a full build) and automatically by an alarm that checks a
// few times a day what is due (refreshPlan): a ratings-only pass once a
// week, the full rebuild once a month (both adjustable on the panel), or
// sooner when the ratings pass has counted many titles the database has
// no name for. Until the first build,
// the toolbar icon carries a "!" badge.
//
// Content scripts send {type: 'rating', title, kind?, refresh?} and get back
//   {rating, votes, year, imdbID, kind, matchedTitle, ts, stale, source,
//    built}  (built: the database's ratings date, for source 'local')
//   {rating: null, ...}                       no match anywhere
//   {error: 'nokey' | 'http' | 'limit'}       nothing stored and OMDb failed
// and {type: 'episodes', imdbID, season} for one season's episode ratings
// (see lookupEpisodes).

// Firefox runs this as an event page, a document with the other background
// scripts listed before it in the manifest, rather than as a service worker, and
// has no offscreen documents: there the build page goes in a hidden frame
// instead (see ensureOffscreen). Firefox also asks the user before data
// leaves the device, so OMDb waits for that consent (omdbConsent in
// compat.js, checked by omdbRequest). Firefox's manifest is generated from
// Chrome's by store/build-zip.ps1.

if (typeof importScripts === 'function') importScripts('compat.js', 'sites-list.js', 'db.js', 'omdb.js', 'lookup.js', 'languages.js', 'refresh.js', 'build.js');

const DB_CHECK_MINUTES = 360; // how often the alarm looks at what is due

// ---------------------------------------------------------------- events

chrome.action.onClicked.addListener(() => openSettings());

// The settings open in their own small window, sized so every setting shows
// (two columns, see options.html). Chrome's embedded options dialog was easy
// to miss and too short; a full tab was mostly white space. A window that is
// already open is brought to the front instead of opening a second one.
const SETTINGS_WINDOW = { width: 960, height: 740 }; // fits both columns (options.html max-width) with Advanced open

async function openSettings() {
  const { settingsWindow } = await chrome.storage.session.get('settingsWindow');
  if (settingsWindow != null) {
    try {
      await chrome.windows.update(settingsWindow, { focused: true });
      return;
    } catch (e) {
      /* it was closed */
    }
  }
  try {
    const w = await chrome.windows.create({
      url: chrome.runtime.getURL('options.html'),
      type: 'popup',
      ...SETTINGS_WINDOW,
    });
    await chrome.storage.session.set({ settingsWindow: w.id });
  } catch (e) {
    await chrome.runtime.openOptionsPage();
  }
}

// Brings the settings window to the front if it is still open.
async function raiseSettings() {
  const { settingsWindow } = await chrome.storage.session.get('settingsWindow');
  if (settingsWindow == null) return;
  await chrome.windows.update(settingsWindow, { focused: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create('db-refresh', { periodInMinutes: DB_CHECK_MINUTES });
  if (details.reason === 'install') {
    // Open the panel and let the user start the first (280 MB) build
    // themselves. Nothing downloads until they click Update now.
    // Installing from the Web Store, Chrome then shows its "added to
    // Chrome" bubble and gives the store page focus again, which put the
    // fresh settings window behind the browser: it flashed up and seemed
    // to vanish. So it is brought back to the front once that settles.
    openSettings().then(() => {
      for (const ms of [1500, 4000]) setTimeout(raiseSettings, ms);
    });
  } else {
    // An update: noted for the settings page, which shows a one-time line
    // for versions that need a word (options.js UPDATE_NOTES).
    if (details.reason === 'update') {
      chrome.storage.local.set({ updateNote: { from: details.previousVersion || '', to: chrome.runtime.getManifest().version } });
    }
    maybeRefresh();
  }
});

// A "!" on the toolbar icon while setup is needed (no database and no
// working OMDb key, the same test as the pages' notice), so a user who closed
// the panel still sees that it isn't finished. OMDb-only users get no "!".
updateBadge();

// The toolbar icon's badge: "!" while the database is missing and OMDb
// cannot stand in, the percentage while a build runs (build.js calls this
// on every whole percent), nothing otherwise.
async function updateBadge() {
  const { needed, building } = await setupStatus();
  const pct = building ? Math.round(((await getBuildState()).pct || 0) * 100) + '%' : '';
  await chrome.action.setBadgeText({ text: building ? pct : needed ? '!' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#f5c518' });
  await chrome.action.setBadgeTextColor({ color: '#000' });
  await chrome.action.setTitle({
    title: building ? 'IMDb Ratings: building the database, ' + pct : needed ? 'IMDb Ratings: click to build the ratings database' : 'IMDb Ratings: settings',
  });
}

// Whether pages should show the "set up" notice: no local database and no
// way to reach OMDb either (no key, a rejected key, or the fallback off), so
// every lookup comes back empty. building: a build is running right now.
async function setupStatus() {
  const { omdbFallback = true, omdbKey } = await omdbSettings();
  const present = !(await omdbOnly()) && (await RatingsDB.status().catch(() => ({ present: false }))).present;
  const needed = !present && (!omdbFallback || !omdbKey || omdbKeyRejected);
  const state = await getBuildState();
  return { needed, building: state.status === 'running' };
}

// A language change has its own listener in languages.js.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.omdbKey) omdbKeyRejected = false;
  if (changes.omdbKey || changes.omdbFallback || changes.ratingsSource) updateBadge();
});

// Stored answers from before OMDb's fuzzy matches were rejected may carry
// some other title's rating for up to 30 days. Drop those once, on the first
// run of this worker version; they get looked up again on demand.
purgeMismatchedAnswers();

const PURGE_VERSION = 2;

async function purgeMismatchedAnswers() {
  const { purgedFuzzy = 0 } = await chrome.storage.local.get('purgedFuzzy');
  if (purgedFuzzy >= PURGE_VERSION) return;
  const all = await chrome.storage.local.get(null);
  const drop = [];
  for (const [k, v] of Object.entries(all)) {
    // Local-database answers legitimately differ from the asked title (the
    // site may use the original title); everything else came from OMDb,
    // including early entries that carry no source field.
    if (!k.startsWith('r:') || !v || v.source === 'local' || !v.matchedTitle) continue;
    const asked = k.slice(2).replace(/^(movie|series):/, '').replace(/^\d{4}:/, '');
    if (!sameTitle(asked, v.matchedTitle)) drop.push(k);
  }
  if (drop.length) await chrome.storage.local.remove(drop);
  await chrome.storage.local.set({ purgedFuzzy: PURGE_VERSION });
}

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('db-refresh', { periodInMinutes: DB_CHECK_MINUTES });
  maybeRefresh();
});

// Optional sites and the user's own addresses (sites-list.js). Adding a
// required host to an update makes Chrome switch the extension off for
// everyone until they accept the new permission, so every site since 1.3
// is optional instead: the settings ask the browser for access when the
// user ticks it, and while access is granted its content script is
// registered here, one registration per address (id name@address). The
// addresses the user added under a site (sync storage "addresses") are
// registered the same way; one wider than the site's own address
// (www.amazon.com over www.amazon.com/gp/video) excludes the site's own
// patterns, which the manifest's script already covers, so no page gets
// the content script twice. Granting or removing access anywhere (the
// settings, or Site access on chrome://extensions) lands in
// permissions.onAdded/onRemoved; checked again whenever the worker starts
// and whenever the addresses change. Needs "scripting" in the manifest's
// permissions and the hosts under optional_host_permissions.
let siteSync = Promise.resolve();

function syncOptionalSites() {
  siteSync = siteSync.then(registerOptionalSites).catch((e) => console.info('[imdbext] optional sites:', String(e)));
  return siteSync;
}

// Every registration wanted now: [{id, matches, excludeMatches?, js}].
async function wantedScripts() {
  const S = IMDBEXT_SITES;
  const { addresses = {} } = await chrome.storage.sync.get('addresses');
  const want = [];
  for (const name of S.NAMES) {
    const site = S.SITES[name];
    const js = [S.adapterFile(name), 'content.js'];
    const own = site.addresses.map(S.patternOf);
    if (site.optional) for (const a of site.addresses) want.push({ id: S.scriptId(name, a), matches: [S.patternOf(a)], js });
    for (const a of S.addedTo(name, addresses)) {
      const excludeMatches = own.filter((p) => p.startsWith('https://' + S.hostOf(a) + '/'));
      want.push({ id: S.scriptId(name, a), matches: [S.patternOf(a)], ...(excludeMatches.length ? { excludeMatches } : {}), js });
    }
  }
  return want;
}

async function registerOptionalSites() {
  if (!chrome.scripting) return;
  const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const want = await wantedScripts();
  const keep = new Set();
  const add = [];
  for (const script of want) {
    if (!(await chrome.permissions.contains({ origins: script.matches }))) continue;
    keep.add(script.id);
    if (!registered.has(script.id)) add.push({ ...script, css: ['badge.css'], runAt: 'document_idle' });
  }
  const stale = [...registered].filter((id) => !keep.has(id));
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
  if (add.length) await chrome.scripting.registerContentScripts(add);
}

syncOptionalSites();
chrome.permissions.onAdded.addListener(() => syncOptionalSites());
chrome.permissions.onRemoved.addListener(() => syncOptionalSites());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.addresses) syncOptionalSites();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'db-refresh') maybeRefresh();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  if (msg.target === 'offscreen') return false; // for the offscreen page

  if (msg.target === 'background') {
    onBuildMessage(msg);
    return false;
  }
  if (msg.type === 'rating' && typeof msg.title === 'string') {
    const kind = msg.kind === 'movie' || msg.kind === 'series' ? msg.kind : null;
    const year = /^(19|20)\d\d$/.test(String(msg.year || '')) ? String(msg.year) : null;
    notePageLang(msg.lang);
    lookup(msg.title, kind, !!msg.refresh, year).then(sendResponse, (e) => sendResponse({ error: String(e) }));
    return true; // keep the channel open for the async reply
  }
  if (msg.type === 'episodes' && /^tt\d+$/.test(msg.imdbID || '') && Number.isInteger(msg.season) && msg.season >= 0) {
    lookupEpisodes(msg.imdbID, msg.season).then(sendResponse, (e) => sendResponse({ episodes: null, error: String(e) }));
    return true;
  }
  if (msg.type === 'extras' && /^tt\d+$/.test(msg.imdbID || '')) {
    lookupExtras(msg.imdbID).then(sendResponse, (e) => sendResponse({ extras: null, error: String(e) }));
    return true;
  }
  if (msg.type === 'usage') {
    usage().then(sendResponse);
    return true;
  }
  if (msg.type === 'test') {
    testKey().then(sendResponse, (e) => sendResponse({ ok: false, detail: String(e) }));
    return true;
  }
  if (msg.type === 'build') {
    // Update now is the full rebuild; 'ratings' is Update ratings only
    // (Advanced), 'akas' the languages' Download button (the chosen
    // languages, fetching the akas file when there is no extract yet).
    if (msg.kind === 'akas') titleLanguages().then((langs) => startBuild('manual', 'akas', langs)).then(sendResponse);
    else startBuild('manual', msg.kind === 'ratings' ? 'ratings' : 'full').then(sendResponse);
    return true;
  }
  if (msg.type === 'cancel-build') {
    cancelBuild().then(sendResponse);
    return true;
  }
  if (msg.type === 'setup') {
    setupStatus().then(sendResponse);
    return true;
  }
  if (msg.type === 'delete-db') {
    deleteDatabase().then(sendResponse, (e) => sendResponse({ ok: false, message: String(e) }));
    return true;
  }
  if (msg.type === 'open-settings') {
    openSettings();
    return false;
  }
  if (msg.type === 'sync-sites') {
    syncOptionalSites().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// ------------------------------------------------- the settings page's status

async function usage() {
  const { usage = {}, limitPauseUntil = 0 } = await chrome.storage.local.get(['usage', 'limitPauseUntil']);
  const { autoRefresh = true } = await chrome.storage.sync.get('autoRefresh');
  const day = utcDay();
  const all = await chrome.storage.local.get(null);
  const stored = Object.keys(all).filter((k) => k.startsWith('r:')).length;
  const local = await RatingsDB.status();
  const next = await refreshPlan(await RatingsDB.getMeta().catch(() => null));
  const build = await getBuildState();
  const keyOk = await omdbKeyConfirmed();
  // The intervals in force (schedule), for the Advanced selects and the texts.
  const schedule = await refreshIntervals();
  return {
    day, today: usage.day === day ? usage.count : 0, limitHit: Date.now() < limitPauseUntil, stored, local, next, build, autoRefresh, keyOk,
    ratingsDays: schedule.ratingsDays, fullDays: schedule.fullDays, schedule,
    omdbOnly: await omdbOnly(),
    langs: await titleLanguages(), // in force: the choice while the box is on
    langsChosen: await chosenLanguages(), // the choice, box on or off
    langsOn: await readOtherLanguages(),
    langsAll: Object.keys(RatingsDB.LANGUAGES),
    langsNeed: RatingsDB.AKAS_NEEDS, // which languages an older extract lacks (options-languages.js onHand)
    langsBrowser: browserLanguages(),
    langsPages: await pageLanguages(),
  };
}
