// The automatic refresh of the local database: the intervals in force
// (refreshIntervals), what is due next (refreshPlan, shared with the
// settings page so both tell the same story) and running it when the
// alarm fires (maybeRefresh). A background script; omdb.js says how they
// load.

// The database refresh (maybeRefresh): the ratings dump is small and
// carries nearly every weekly change, so it is re-read weekly; the title
// and episode lists (the bulk of the download) only when new titles are
// due. Without a working OMDb key the full rebuild is the only way new
// titles arrive, so it comes monthly. Those are the defaults: the settings
// page's Advanced section stores other intervals as ratingsDays and
// fullDays in sync storage (refreshIntervals); someone with a working OMDb
// key, which covers new titles meanwhile, can stretch the rebuild there,
// and fullDays 0 leaves every full rebuild to Update now (the ratings
// pass keeps its schedule). A ratings pass that finds this many rated IDs
// without a name brings the full rebuild forward whatever the interval:
// titles and episodes cross the 25-vote line at a few hundred a week, so
// the usual schedule stays well under it.
const RATINGS_DAYS = 7;
const FULL_DAYS = 30;
const RATINGS_DAYS_CHOICES = [7, 14, 30];
const FULL_DAYS_CHOICES = [30, 61, 91, 0]; // 0: only by Update now
// How often a rebuild also reads a fresh list of titles in other
// languages (520 MB; db.js akasStale). 0: only the Refresh titles button.
const AKAS_DAYS_CHOICES = [91, 182, 365, 0];
const UNKNOWN_REBUILD = 10000;
const DOWNLOAD_MB = { ratings: 9, full: 280, akas: 520 }; // what the settings page says each costs

// Best effort: Chrome only reports this on Android and ChromeOS. On desktop
// it is always "unknown", so this never blocks there.
function looksMetered() {
  const c = typeof navigator !== 'undefined' && navigator.connection;
  return !!c && (c.saveData === true || c.type === 'cellular');
}

// Whether OMDb can stand in for the full rebuild: lookups on and the saved
// key confirmed working.
async function omdbUsable() {
  const { omdbFallback = true } = await omdbSettings();
  return omdbFallback && (await omdbKeyConfirmed());
}

// The user chose "OMDb only" on the settings page (sync ratingsSource):
// no local database is built, refreshed or consulted, and every lookup
// goes to OMDb (none can be answered until a key works; the page says so).
// A database that exists is kept, unused, so switching back costs nothing
// (the next check then runs whatever refresh its age calls for).
async function omdbOnly() {
  const { ratingsSource } = await chrome.storage.sync.get('ratingsSource');
  return ratingsSource === 'omdb';
}

// The refresh intervals in force: { ratingsDays, fullDays, akasDays,
// manual, keyed }. ratingsDays, fullDays and akasDays are the user's
// choices from sync storage, or the defaults; a value outside the offered
// choices counts as unset.
// manual: fullDays 0, no full rebuild starts by itself. keyed: OMDb
// lookups on and the key confirmed, for the texts.
async function refreshIntervals() {
  const { ratingsDays, fullDays, akasDays } = await chrome.storage.sync.get(['ratingsDays', 'fullDays', 'akasDays']);
  const full = FULL_DAYS_CHOICES.includes(fullDays) ? fullDays : FULL_DAYS;
  return {
    ratingsDays: RATINGS_DAYS_CHOICES.includes(ratingsDays) ? ratingsDays : RATINGS_DAYS,
    fullDays: full,
    akasDays: AKAS_DAYS_CHOICES.includes(akasDays) ? akasDays : RatingsDB.AKAS_DAYS,
    manual: full === 0,
    keyed: await omdbUsable(),
  };
}

// What the next automatic refresh is and when it is due, from the
// database's meta record: { kind: 'full' | 'ratings' | 'akas', reason,
// due, mb, langs, keyed, ratingsDays, fullDays, manual } (the last four
// from refreshIntervals), or { kind: null } without a database. Shared by
// maybeRefresh and the settings page (usage), so both tell the same story.
//   format    built by an older version (db.js FORMAT): rebuilt once,
//             whatever its age, since lookups would miss some old keys
//   episodes  the episode stage never finished (interrupted first run)
//   unknown   the ratings pass found UNKNOWN_REBUILD or more rated IDs
//             the database has no name for
//   age       the usual schedule
//   languages (kind 'akas', mb 0) the chosen languages differ from the
//             keyed ones and the extract is on hand: keyed again from it.
//             Only with the box on: off, the keys stay for turning it back
//             on (languages.js applyLanguageChoice), so nothing is due
//   download  (kind 'akas', mb 520) languages chosen but no extract yet:
//             waits for the settings page's Get titles button, never runs
//             by itself. Only the settings page sees this plan; the
//             scheduler (scheduled: true) skips it and goes on with the
//             ratings and rebuild schedule, which the wait must not stall.
// A full plan's mb includes the akas file when the build will fetch it
// (akas: true: languages chosen and the extract on hand akasDays old; a
// missing one is Get titles' job, so no rebuild fetches it unasked).
// With manual set, a full plan is only what Update now would do: format
// and episodes still come back (the ratings pass cannot run on such a
// database, so nothing runs by itself), the other reasons do not, and
// the ratings pass keeps its schedule.
async function refreshPlan(meta, { scheduled = false } = {}) {
  if (!meta || (await omdbOnly())) return { kind: null };
  const now = Date.now();
  const s = await refreshIntervals();
  const langsOn = await otherLanguagesOn();
  const langs = await titleLanguages();
  const akas = langs.length > 0 && (RatingsDB.akasStale(meta, s.akasDays) || !RatingsDB.akasCovers(meta, langs));
  // fullMb and akas ride on every plan: what Update now would download
  // today, and whether that includes a fresh titles list.
  const fullMb = DOWNLOAD_MB.full + (akas ? DOWNLOAD_MB.akas : 0);
  s.fullMb = fullMb;
  s.akas = akas;
  const full = (reason, due) => ({ kind: 'full', reason, due, mb: fullMb, langs, ...s });
  if ((meta.format || 1) < RatingsDB.FORMAT) return full('format', now);
  if (!meta.episodes) return full('episodes', now);
  const ratingsDue = (meta.ratingsAt || meta.builtAt || 0) + s.ratingsDays * DAY_MS;
  const fullDue = (meta.builtAt || 0) + s.fullDays * DAY_MS;
  if (!s.manual) {
    if ((meta.unknown || 0) >= UNKNOWN_REBUILD) return full('unknown', now);
    if (fullDue <= now) return full('age', fullDue);
  }
  if (langsOn && !sameSet(langs, meta.langs || [])) {
    if ((meta.akasAt && RatingsDB.akasCovers(meta, langs)) || !langs.length) return { kind: 'akas', reason: 'languages', due: now, mb: 0, langs, ...s };
    if (!scheduled) return { kind: 'akas', reason: 'download', due: now, mb: DOWNLOAD_MB.akas, langs, ...s };
  }
  if (!s.manual && fullDue <= ratingsDue) return full('age', fullDue);
  return { kind: 'ratings', reason: 'age', due: ratingsDue, mb: DOWNLOAD_MB.ratings, ...s };
}

// Runs whatever refresh is due (refreshPlan), if the user built a database
// in the first place and hasn't switched the automatic refresh off. The
// first build is always the user's own click, so nothing downloads unasked.
async function maybeRefresh() {
  const { autoRefresh = true } = await chrome.storage.sync.get('autoRefresh');
  const state = await getBuildState();
  if (state.status === 'running') return;
  const plan = await refreshPlan(await RatingsDB.getMeta(), { scheduled: true });
  if (!plan.kind || plan.due > Date.now()) return;
  if (plan.kind === 'akas') {
    // Keying the chosen languages from the extract is local work the
    // user asked for by ticking them, so it needs no automatic refresh,
    // and none of the wait below: a cancelled or failed run that left
    // them unkeyed is put right at the next check. (Fetching the file is
    // the Get titles button's alone; a scheduled plan never says
    // 'download', so the ratings pass below keeps its schedule while
    // that button waits.)
    await startBuild('auto', 'akas', plan.langs);
    return;
  }
  // Don't hammer IMDb if builds keep failing: wait a day after an error,
  // and after a build the user cancelled, which said "not now".
  if ((state.status === 'error' || state.status === 'cancelled') && Date.now() - (state.at || 0) < DAY_MS) return;
  if (!autoRefresh) return;
  if (plan.kind === 'full' && plan.manual) return; // Update now's job
  if (looksMetered()) return; // try again at the next check
  await startBuild(plan.reason === 'format' ? 'format' : 'auto', plan.kind);
}
