// The OMDb client of the background scripts: one request with the shared
// rules (omdbRequest: key, Firefox consent, the pause after the daily
// limit, the request count), the title lookup that holds OMDb to
// whole-title matches (fetchRating), the extra scores (parseExtras),
// whether the saved key is known to work (omdbKeyConfirmed), and the
// settings page's Test button (testKey). The answers are remembered by
// lookup.js, never here.
//
// The background is six scripts in one global scope, loaded in this order:
// compat.js, db.js, omdb.js, lookup.js, languages.js, refresh.js, build.js,
// background.js (importScripts in Chrome, the manifest's script list in
// Firefox, store/firefox-manifest.mjs). Each file only needs what loads
// before it at load time; at call time they use each other freely.

const LIMIT_PAUSE_MS = 60 * 60 * 1000; // after OMDb reports the limit

let omdbKeyRejected = false; // OMDb called the saved key invalid

// OMDb settings as they apply: the fallback counts as off in Firefox until
// the user allows the extension to send title names off the device
// (omdbConsent, compat.js), so lookups settle for what is stored and the
// setup notice knows OMDb can't answer. omdbRequest checks the consent
// again itself, so no caller can send anything without it.
async function omdbSettings(more = []) {
  const s = await chrome.storage.sync.get(['omdbFallback', 'omdbKey', 'ratingsSource', ...more]);
  if (s.ratingsSource === 'omdb') s.omdbFallback = true; // OMDb only has no other source (the page keeps the box on)
  if (s.omdbFallback !== false && !(await omdbConsent())) s.omdbFallback = false;
  return s;
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}


async function countRequest() {
  const day = utcDay();
  const { usage = {} } = await chrome.storage.local.get('usage');
  const count = usage.day === day ? usage.count + 1 : 1;
  await chrome.storage.local.set({ usage: { day, count } });
}

// One OMDb request with the shared rules: needs a key and (Firefox) the
// user's consent, respects the pause after the daily limit, counts toward
// today's usage, and turns OMDb's errors into {error: 'nokey' | 'consent' |
// 'limit' | 'http'}. Otherwise {data}, the parsed answer, which may still be
// {Response: 'False'} for "not found". Every request goes through here, so
// this is the one place that keeps data on the device until it is allowed.
async function omdbRequest(params) {
  const { omdbKey } = await chrome.storage.sync.get('omdbKey');
  if (!omdbKey) return { error: 'nokey' };
  if (!(await omdbConsent())) return { error: 'consent' };

  const { limitPauseUntil = 0 } = await chrome.storage.local.get('limitPauseUntil');
  if (Date.now() < limitPauseUntil) return { error: 'limit' };

  const url = new URL('https://www.omdbapi.com/');
  url.searchParams.set('apikey', omdbKey);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);

  await countRequest();
  let res;
  try {
    res = await fetch(url.toString());
  } catch (e) {
    return { error: 'http' };
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* non-JSON body; handled below */
  }
  const errText = (data && data.Error) || '';

  // OMDb uses 401 for both a bad/unactivated key and the daily limit, so
  // read the message before deciding.
  if (/invalid api key/i.test(errText)) {
    if (!omdbKeyRejected) {
      omdbKeyRejected = true;
      updateBadge();
    }
    await markKey(omdbKey, false);
    return { error: 'nokey' };
  }
  if (res.status === 401 || /limit/i.test(errText)) {
    // Pause for an hour, then try again: cheap, and self-healing if the
    // 401 was really something else.
    await chrome.storage.local.set({ limitPauseUntil: Date.now() + LIMIT_PAUSE_MS });
    return { error: 'limit' };
  }
  if (!res.ok || !data) return { error: 'http' };
  await markKey(omdbKey, true);
  return { data };
}

// Whether the saved key is known to work: OMDb answered a request made with
// it. The settings only offer the extra scores then. Kept as a fingerprint
// of the key, so a changed key starts unconfirmed; OMDb rejecting it clears
// it. A daily-limit answer leaves it alone (the key is fine, just spent).
let keyOkCache = null;

function keyFingerprint(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  return String(h);
}

async function markKey(key, ok) {
  const value = ok ? keyFingerprint(key) : null;
  if (keyOkCache === value) return;
  keyOkCache = value;
  if (ok) await chrome.storage.local.set({ omdbKeyOk: value });
  else await chrome.storage.local.remove('omdbKeyOk');
}

async function omdbKeyConfirmed() {
  const { omdbKey } = await chrome.storage.sync.get('omdbKey');
  const { omdbKeyOk } = await chrome.storage.local.get('omdbKeyOk');
  return !!omdbKey && omdbKeyOk === keyFingerprint(omdbKey);
}

function parseExtras(data) {
  const source = (name) => ((data.Ratings || []).find((r) => r.Source === name) || {}).Value || null;
  const rt = source('Rotten Tomatoes');
  const mcValue = source('Metacritic') || (data.Metascore && data.Metascore !== 'N/A' ? data.Metascore : null);
  const mc = mcValue ? parseInt(mcValue, 10) : NaN;
  // Only a headline about a major award ("Won 3 Oscars.", "Nominated for 2
  // Primetime Emmys."), not the "12 wins & 40 nominations total" tally.
  const first = ((data.Awards || '').split('. ')[0] || '').replace(/\.$/, '').trim();
  const awards = /\b(oscars?|emmys?|golden globes?|baftas?)\b/i.test(first) ? first : null;
  const imdb = parseFloat(data.imdbRating);
  const extras = { rt: /^\d+%$/.test(rt || '') ? rt : null, mc: Number.isFinite(mc) ? mc : null, awards, imdb: Number.isFinite(imdb) ? imdb : null };
  if (!(extras.rt || extras.mc != null || extras.awards || extras.imdb != null)) return null;
  // For the links: the Rotten Tomatoes page when OMDb knows it, and the
  // title to search the two sites with otherwise.
  if (/^https:\/\/(www\.)?rottentomatoes\.com\//.test(data.tomatoURL || '')) extras.rtUrl = data.tomatoURL;
  extras.title = data.Title || null;
  return extras;
}

// The year is the site's hint. The local database treats it as a
// preference among same-named titles, but OMDb takes y as a hard filter,
// and for a series the site's year is often the latest season's ("2026 ·
// 4 Parts" for a show that began in 2021). So a miss with the year is
// asked again without it; the title guard below still applies.
async function fetchRating(title, kind, year) {
  const r = await fetchRatingOnce(title, kind, year);
  if (year && !r.error && r.rating == null) return fetchRatingOnce(title, kind, null);
  return r;
}

async function fetchRatingOnce(title, kind, year) {
  const r = await omdbRequest({ t: title, type: kind, y: year });
  if (r.error) return r;
  const data = r.data;
  if (data.Response !== 'True') return { rating: null };

  // OMDb's title search is fuzzy: asked for "Youth" it can answer with
  // "Hwarang: The Poet Warrior Youth". The local database only matches whole
  // titles, so hold OMDb to the same standard and treat anything else as a
  // miss (recorded, so the badge tooltip can say what was offered).
  if (!sameTitle(title, data.Title)) {
    return { rating: null, source: 'omdb', offered: data.Title || null };
  }

  const rating = parseFloat(data.imdbRating);
  return {
    rating: Number.isFinite(rating) ? rating : null,
    votes: data.imdbVotes && data.imdbVotes !== 'N/A' ? data.imdbVotes : null,
    year: data.Year || null,
    imdbID: data.imdbID || null,
    kind: data.Type || null,
    matchedTitle: data.Title || null,
    source: 'omdb',
  };
}

// Same title once accents, case, punctuation and a leading article are
// ignored, so "The Pitt" and "Pitt" agree but "Youth" and "Hwarang: The Poet
// Warrior Youth" do not.
function sameTitle(a, b) {
  const clean = (t) => RatingsDB.normalise(t).replace(/^(the|a|an) /, '');
  const x = clean(a);
  const y = clean(b);
  return !!x && x === y;
}

// One request, bypassing the pause, so the options page can show exactly what
// OMDb says about the saved key. A success clears any pause.
// The settings panel's Test button: one title and one season request through
// the same omdbRequest() the lookups use, so a pass means both kinds work.
// A pause after an earlier "limit reached" is lifted first: the user is
// asking to try now.
async function testKey() {
  const { omdbKey } = await chrome.storage.sync.get('omdbKey');
  if (!omdbKey) return { ok: false, detail: 'no key saved.' };
  await chrome.storage.local.remove('limitPauseUntil');
  omdbKeyRejected = false;

  // detail fits the panel's one result line; more is the tooltip behind it.
  const NAMES = {
    nokey: 'invalid or not activated yet',
    consent: 'Firefox did not allow sending titles to OMDb',
    limit: 'daily limit reached',
    http: 'could not reach OMDb',
  };
  const title = await omdbRequest({ i: 'tt0111161' }); // The Shawshank Redemption
  if (title.error) return { ok: false, detail: (NAMES[title.error] || title.error) + '.' };
  if (title.data.Response !== 'True') return { ok: false, detail: (title.data.Error || 'unexpected answer') + '.' };

  const season = await omdbRequest({ i: 'tt0903747', Season: '1' }); // Breaking Bad
  const rated = season.data && season.data.Response === 'True'
    ? (season.data.Episodes || []).filter((e) => Number.isFinite(parseFloat(e.imdbRating))).length
    : 0;
  const d = title.data;
  const why = season.error ? NAMES[season.error] || season.error : (season.data && season.data.Error) || 'no ratings';
  return {
    ok: !!rated,
    detail: rated ? 'titles and episodes both answered.' : 'titles yes, seasons no (' + why + ').',
    more: d.Title + ' (' + d.Year + ') rated ' + d.imdbRating + '; Breaking Bad season 1: ' + rated + ' rated episodes.',
  };
}
