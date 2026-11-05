// Titles in other languages: which languages the database should match
// titles in (titleLanguages, from the settings page's ticks), the
// languages worth suggesting there (the browser's own and those seen on
// streaming pages, notePageLang), and applying a changed choice to the
// database (applyLanguageChoice). A background script; omdb.js says how
// they load.

// Languages besides English the settings page suggests ticking (db.js
// LANGUAGES): the browser's own (navigator.languages, "pl-PL" -> pl) and
// those of the streaming pages seen, which content scripts send with each
// lookup (a Polish Netflix profile in an English browser). Streaming sites
// show titles in the profile's language, and IMDb's title list has only
// the English and original names, so without this a Polish user sees no
// badge on "Zadzwoń do Saula". A page language not seen for half a year
// is forgotten.
const PAGE_LANG_KEEP_MS = 180 * DAY_MS;

const langCode = (tag) => RatingsDB.languageOf(String(tag || '').toLowerCase().split(/[-_]/)[0]);

function browserLanguages() {
  const out = [];
  for (const tag of navigator.languages || []) {
    const l = langCode(tag);
    if (RatingsDB.LANGUAGES[l] && !out.includes(l)) out.push(l);
  }
  return out;
}

async function pageLanguages() {
  const { pageLangs = {} } = await chrome.storage.local.get('pageLangs');
  return Object.keys(pageLangs).filter((l) => RatingsDB.LANGUAGES[l] && Date.now() - pageLangs[l] < PAGE_LANG_KEEP_MS);
}

async function seenLanguages() {
  return [...new Set([...browserLanguages(), ...(await pageLanguages())])];
}

// The languages the database should match titles in: the ones ticked on
// the settings page (sync titleLangs), once "Match titles in other
// languages" is on (sync otherLanguages; off by default, since the akas
// file is a 520 MB download that an English browser on English pages
// never needs). Off, the akas store is neither built nor consulted.
// Asked on every lookup, so the answer is kept in memory; the
// storage.onChanged listener above updates it.
let otherLanguagesCache = null;

async function otherLanguagesOn() {
  if (otherLanguagesCache === null) {
    const { otherLanguages = false } = await chrome.storage.sync.get('otherLanguages');
    otherLanguagesCache = otherLanguages === true;
  }
  return otherLanguagesCache;
}

async function titleLanguages() {
  if (!(await otherLanguagesOn())) return [];
  const { titleLangs = [] } = await chrome.storage.sync.get('titleLangs');
  // nb ticked under an earlier version counts as no.
  return [...new Set((Array.isArray(titleLangs) ? titleLangs : []).map(RatingsDB.languageOf))].filter((l) => RatingsDB.LANGUAGES[l]);
}

// A streaming page's language, from a lookup, written once a day per
// language. It only ever suggests; nothing downloads until the user ticks
// the language and clicks Download.
const notedLangs = new Map();

async function notePageLang(tag) {
  const l = langCode(tag);
  if (!RatingsDB.LANGUAGES[l] || Date.now() - (notedLangs.get(l) || 0) < DAY_MS) return;
  notedLangs.set(l, Date.now());
  const { pageLangs = {} } = await chrome.storage.local.get('pageLangs');
  pageLangs[l] = Date.now();
  await chrome.storage.local.set({ pageLangs });
}

// "Match titles in other languages" or its language list changed. Off:
// the keys stay (lookups ignore them while the option is off), so turning
// it back on is instant; unless no choice is stored any more (Reset
// settings), when they are stale and go, or the page would report them
// as matched and the next tick would start a pass to remove them. A new list of languages (the
// settings page writes it on Apply) is keyed from the extract on hand, a
// local job of seconds, so it runs now, with the automatic refresh off or
// the full rebuild set to manual too. On again after a rebuild dropped
// the keys: keyed again the same way, by itself. With no extract yet, nothing happens until the Get
// titles button (the build message, kind 'akas'): the 520 MB is only
// ever the user's own click.
// During a build the change waits; handleBuildMessage applies it when
// the build ends.
async function applyLanguageChoice() {
  if ((await getBuildState()).status === 'running') return;
  const meta = await RatingsDB.getMeta();
  if (!meta) return; // nothing to key or clear (OMDb only, or no build yet)
  if (!(await otherLanguagesOn())) {
    const { titleLangs } = await chrome.storage.sync.get('titleLangs');
    const stored = Array.isArray(titleLangs) && titleLangs.length > 0;
    if (!stored && (meta.langs || []).length) await RatingsDB.clearAkas();
    return;
  }
  const langs = await titleLanguages();
  if (sameSet(langs, meta.langs || [])) return;
  // From the extract on hand, in seconds; one that lacks a language just
  // added (akasCovers) is Get titles' job, the user's own click.
  if (!langs.length || (RatingsDB.akasCovers(meta, langs) && (await RatingsDB.getFile()))) await startBuild('manual', 'akas', langs);
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
