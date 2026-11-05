// Answering the content scripts: a title's rating (lookup), one season's
// episode ratings (lookupEpisodes) and the extra scores (lookupExtras),
// each from the remembered answers in chrome.storage.local first, then
// the local database (db.js), then OMDb (omdb.js) through a small queue
// (schedule) so a page with 200 cards does not fire 200 requests at once.
// A background script; omdb.js says how they load.

const HIT_REFRESH_MS = 30 * DAY_MS; // ratings barely move
const MISS_REFRESH_MS = 3 * DAY_MS; // new titles show up within days
const LEARNED_REFRESH_MS = 7 * DAY_MS; // a title known by ID follows the weekly ratings pass
const MAX_IN_FLIGHT = 4;

const inFlight = new Map(); // storeKey -> Promise
let active = 0;
const queue = [];


// Streaming sites wrap titles in packaging IMDb doesn't use. When the exact
// title isn't in the database, these variants are tried, safest first:
//   "Damaged (2024)"            -> "Damaged", year 2024
//   "Helluva Boss - Season 3A", "Timbiriche season-1" -> without the season
//   "Greater [OV]"              -> without a trailing [note]
//   "Red Eye (UK)"              -> without a trailing (note)
//   "Clip: Full Custom Garage"  -> without "Clip:"
//   "South Park The Streaming Wars Part 1" -> without a trailing "Part 1":
//                                  IMDb names a first part plainly, and
//                                  only the sequel "Part 2"
// Only packaging is removed. Matching on the part before a colon was tried
// and dropped: it mostly found a different title ("Dunkirk: The Real Story"
// is not the 1958 film), and a new spinoff not yet in IMDb's data ("Star
// Trek: …") would borrow the original show's rating.
// Measured on 190 Prime Video titles: 83% matched before, 86% after, and no
// wrong matches; nearly all the rest aren't in IMDb's data under any name.
function titleVariants(title, kind) {
  const out = [];
  // "Scary Movie (2026) - Extended Cut": the cut goes first, so the year
  // before it is still found.
  let t = title.replace(/\s*[-–:]\s*(the\s+)?(extended|unrated|director[’']s|theatrical|final)\s+(cut|edition)\s*$/i, ''); // "Blade Runner: The Final Cut"
  let year = null;
  const y = t.match(/\s*\(((?:19|20)\d\d)\)\s*$/);
  if (y) {
    year = y[1];
    t = t.slice(0, y.index);
  }
  t = t
    .replace(/\s*[-–:,]?\s*season[\s-]*\d+[a-z]?\s*$/i, '')
    .replace(/\s*\[[^\]]*\]\s*$/, '')
    .replace(/\s*\([^()]{1,25}\)\s*$/, '') // "Red Eye (UK)", "The Office (US)", "(Dubbed)"
    .replace(/\s+(UK|US)$/, '') // "Ghosts UK"
    .replace(/\s*[-–:,]?\s*part\s+(1|one|i)\s*$/i, '') // after the notes, so "X Part 1 (Dubbed)" loses both
    .replace(/^clip:\s*/i, '')
    // Sites credit a name in the title that IMDb leaves out: "Tyler
    // Perry's Boo! A Madea Halloween" is "Boo! A Madea Halloween",
    // "Maurice Sendak's Little Bear" is "Little Bear". A first and last name
    // (or a known studio) with "'s". Only tried after the full title missed,
    // so IMDb titles that keep the credit ("Tim Burton's Corpse Bride",
    // "Mike Judge's Beavis and Butt-Head") still match as they are.
    .replace(/^((marvel studios|disney)[’']s?|\p{Lu}[\p{Ll}.]+ \p{Lu}[\p{Ll}]+[’']s)\s+/u, '')
    .trim();
  if (t && t !== title) out.push({ title: t, kind, year });
  return out;
}

async function lookupLocal(title, kind, year) {
  const akas = await otherLanguagesOn(); // titles in other languages only when asked for
  const exact = await RatingsDB.lookup(title, kind, year, akas);
  if (exact) return exact;
  for (const v of titleVariants(title, kind)) {
    const hit = await RatingsDB.lookup(v.title, v.kind, v.year || year, akas);
    if (hit) return hit;
  }
  return null;
}

// Entries looked up with a type hint are stored separately from untyped
// ones, since the match can differ.
// 'r:<title>', 'r:series:<title>', 'r:series:2026:<title>': the more the
// site told us, the more specific the key.

function storeKey(title, kind, year) {
  return 'r:' + (kind ? kind + ':' : '') + (year ? year + ':' : '') + title.trim().toLowerCase().replace(/\s+/g, ' ');
}

// A learned title: OMDb matched the name to an IMDb ID once, and that
// mapping is kept for good. Its rating comes from the local ids table by
// that ID whenever the table has it (this week's dump; OMDb's copy lags),
// otherwise OMDb's answer stays as it was. Either way the title is never
// sent to OMDb again. A name the database learns itself (a full rebuild)
// still wins: lookup tries the name first.
function isLearned(entry) {
  return !!entry && entry.rating != null && /^tt\d+$/.test(entry.imdbID || '') &&
    (entry.learned === true || entry.source === 'omdb');
}

function isStale(entry) {
  const window = entry.rating == null ? MISS_REFRESH_MS : isLearned(entry) ? LEARNED_REFRESH_MS : HIT_REFRESH_MS;
  return Date.now() - (entry.ts || 0) > window;
}

// The local rating for a learned entry's ID, folded into the entry; the
// entry unchanged when the ids table lacks the ID.
async function byLearnedId(entry) {
  const cur = await RatingsDB.lookupById(entry.imdbID).catch(() => null);
  if (!cur) return entry;
  return { ...entry, rating: cur.rating, votes: cur.votes, built: cur.built, source: 'local', learned: true };
}

async function lookup(title, kind, refresh, year) {
  const key = storeKey(title, kind, year);
  if (!title.trim()) return { rating: null };

  // A hit found with a type or year hint is better than whatever the less
  // specific lookups (which the cards use) settled on for the same title,
  // so it replaces those entries too.
  const broaderKeys = [];
  if (year) broaderKeys.push(storeKey(title, kind, null));
  if (kind) broaderKeys.push(storeKey(title, null, null));

  const stored = (await chrome.storage.local.get(key))[key];
  const fresh = stored && (!refresh || !isStale(stored));
  if (fresh && stored.rating != null) {
    return { ...stored, stale: isStale(stored) };
  }

  // Nothing stored, a stale entry we've been asked to refresh, or a
  // remembered miss. The local database answers first; it costs no requests.
  // A remembered miss (OMDb's, from while there was no database, say) must
  // not hide a rating the database has now, so it gets this check too.
  const local = (await omdbOnly()) ? null : await lookupLocal(title, kind, year);
  if (local) {
    const entry = { ...local, ts: Date.now() };
    const writes = { [key]: entry };
    for (const k of broaderKeys) writes[k] = entry;
    await chrome.storage.local.set(writes);
    return { ...entry, stale: false };
  }
  // A learned title (see isLearned) is refreshed from the ids table by its
  // ID and never goes back to OMDb.
  if (isLearned(stored)) {
    const entry = { ...(await byLearnedId(stored)), ts: Date.now() };
    await chrome.storage.local.set({ [key]: entry });
    return { ...entry, stale: false };
  }
  if (fresh) return { ...stored, stale: isStale(stored) }; // still a miss

  // Without a key, or with the fallback switched off, a local miss is simply
  // a miss. (If there is no local database either, fetchRating() reports
  // 'nokey' so the page can warn.)
  const { omdbFallback = true, omdbKey } = await omdbSettings();
  const localPresent = !(await omdbOnly()) && (await RatingsDB.status()).present;
  if (!omdbFallback || (!omdbKey && localPresent)) {
    return stored ? { ...stored, stale: false } : { rating: null, source: 'local' };
  }

  if (inFlight.has(key)) return inFlight.get(key);
  const p = schedule(() => fetchRating(title, kind, year))
    .then(async (result) => {
      if (result.error) {
        return stored ? { ...stored, stale: false } : result; // keep the old answer
      }
      // A hit names an IMDb ID: from now on the title is known by it, and
      // the local table's rating for that ID beats the copy OMDb sent.
      const entry = { ...(isLearned(result) ? await byLearnedId(result) : result), ts: Date.now() };
      const writes = { [key]: entry };
      if (entry.rating != null) for (const k of broaderKeys) writes[k] = entry;
      await chrome.storage.local.set(writes);
      return { ...entry, stale: false };
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// Episode ratings for one season of a series, by the series' IMDb ID:
//   {episodes: {"<episode>": [rating, votes | null]}, source} or {episodes: null}
// The local database answers first. Failing that (no database, or a season
// newer than the last full build), and with the OMDb fallback on and a
// key saved, OMDb's season listing: one request per season, remembered for
// a week because new episodes keep collecting votes. OMDb gives no vote
// counts per episode, hence null.
const SEASON_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

async function lookupEpisodes(imdbID, season) {
  const local = (await omdbOnly()) ? null : await RatingsDB.lookupEpisodes(imdbID, season).catch(() => null);
  if (local) return { episodes: local, source: 'local' };

  const key = 'e:' + imdbID + ':' + season;
  const stored = (await chrome.storage.local.get(key))[key];
  if (stored && Date.now() - stored.ts < SEASON_REFRESH_MS) return { episodes: stored.episodes, source: 'omdb' };

  const { omdbFallback = true, omdbKey } = await omdbSettings();
  if (!omdbFallback || !omdbKey) return { episodes: stored ? stored.episodes : null };

  if (inFlight.has(key)) return inFlight.get(key);
  const p = schedule(() => omdbRequest({ i: imdbID, Season: String(season) }))
    .then(async (r) => {
      if (r.error) return { episodes: stored ? stored.episodes : null, error: r.error };
      const eps = {};
      if (r.data.Response === 'True') {
        for (const e of r.data.Episodes || []) {
          const n = Number(e.Episode);
          const rating = parseFloat(e.imdbRating);
          if (Number.isInteger(n) && Number.isFinite(rating)) eps[n] = [rating, null];
        }
      }
      const episodes = Object.keys(eps).length ? eps : null;
      await chrome.storage.local.set({ [key]: { episodes, ts: Date.now() } });
      return { episodes, source: 'omdb' };
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// Concurrency limiter so a page with 200 cards doesn't fire 200 requests at once.
function schedule(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

function pump() {
  while (active < MAX_IN_FLIGHT && queue.length) {
    const { task, resolve, reject } = queue.shift();
    active++;
    task()
      .then(resolve, reject)
      .finally(() => {
        active--;
        pump();
      });
  }
}

// Extra scores from OMDb for one title, asked by its IMDb ID (exact; no
// title matching): Rotten Tomatoes (critics' Tomatometer), Metacritic, the
// awards headline, and OMDb's own copy of the IMDb rating (the page shows
// it only when it isn't the badge's number). Only when the user ticked at
// least one of them, OMDb lookups are on and the key is confirmed. Kept 30
// days, misses too; one request per title ever opened, not per card, so it
// fits a free key's 1,000 a day.
// -> {extras: {rt: '92%', mc: 74, awards: 'Won 3 Oscars', imdb: 8.3} | null}
async function lookupExtras(imdbID) {
  // Nothing saved means the scores and awards on, the IMDb figure off (the
  // same default as options.js).
  const { extraRatings = { rt: true, mc: true, awards: true, cards: true }, omdbFallback = true } = await omdbSettings(['extraRatings']);
  if (!omdbFallback || !(extraRatings.rt || extraRatings.mc || extraRatings.awards || extraRatings.imdb)) return { extras: null };
  const key = 'x:' + imdbID;
  const stored = (await chrome.storage.local.get(key))[key];
  // Answers kept before the IMDb figure was part of them (no v) lack it, and
  // a title with only that figure was kept as a miss, so with the box ticked
  // such an answer is asked again.
  const usable = stored && (stored.v === 2 || !extraRatings.imdb);
  if (usable && Date.now() - stored.ts < HIT_REFRESH_MS) return { extras: stored.extras };
  if (!(await omdbKeyConfirmed())) return { extras: stored ? stored.extras : null };

  if (inFlight.has(key)) return inFlight.get(key);
  // tomatoes=true adds tomatoURL, the title's Rotten Tomatoes page, when OMDb has it.
  const p = schedule(() => omdbRequest({ i: imdbID, tomatoes: 'true' }))
    .then(async (r) => {
      if (r.error) return { extras: stored ? stored.extras : null, error: r.error };
      const extras = r.data.Response === 'True' ? parseExtras(r.data) : null;
      await chrome.storage.local.set({ [key]: { extras, ts: Date.now(), v: 2 } });
      return { extras };
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
