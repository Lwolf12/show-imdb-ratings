// The local ratings database, kept in IndexedDB. Shared by the service worker
// (lookups), the build worker (writes) and the options page (status). Loaded
// with importScripts() in workers.
//
// Layout:
//   meta      key 'info' -> { built, builtAt, ratingsBuilt, ratingsAt,
//             minVotes, titles, episodes, episodesPending, ids, unknown,
//             keys, store, format }
//   titles_a  keyPath 'k' -> { k: normalised title, e: [entry, ...] }
//   titles_b  same; a build writes into whichever store is NOT live, then
//             flips meta.store, so lookups never see a half-written database.
//   episodes_a, episodes_b  keyPath 'k' -> { k: series imdbID,
//             s: { "<season>": [[episode, rating, votes, imdbID], ...] } };
//             paired with titles_a/_b and flipped with them.
//   ids       key imdbID -> [rating, votes] for every title (not episode)
//             with minVotes or more votes, as of the last ratings pass; a
//             third element 1 marks an ID the database has no name for
//             (rated since the last full build; see updateRatings). Lookups
//             read the rating from here, so a weekly pass over the small
//             ratings dump refreshes every title without touching the
//             title index; the rating in each entry is the full build's
//             copy, kept for the ordering and as a fallback.
//
// entry = [imdbID, type ('m' movie | 's' series), startYear|null, rating,
//          votes, primaryTitle], sorted most-voted first.
//
// A full build (builder.js build) lands in two stages: writeTitles makes the
// titles and ids live, so lookups work while the episodes still stream in,
// and writeEpisodes fills the live episode store afterwards. A ratings pass
// (updateRatings) rewrites ids and the episode ratings in place.

const RatingsDB = (() => {
  'use strict';

  const NAME = 'imdbext-ratings';
  const VERSION = 3; // 2 added the episode stores, 3 the ids store
  let conn = null;

  // What the stored keys were built with. A database of an older format is
  // rebuilt once after an update (background.js maybeRefresh).
  //   1  movies, TV films and series; plain normalise
  //   2  also direct-to-video, TV specials, TV shorts and shorts (builder.js
  //      TYPE), and abbreviations joined in normalise
  //   3  the ids table and episode rows carrying their imdbID, which the
  //      weekly ratings-only pass needs
  const FORMAT = 3;

  // Used for both building and lookup. Keep in one place.
  // Dotted or starred abbreviations come out as single letters ("Car S.O.S."
  // -> "car s o s"); two or more single letters in a row are joined, so
  // "Car SOS" and "Car S.O.S." (or "SWAT" and "S.W.A.T.", "MASH" and
  // "M*A*S*H") give the same key. A lone letter stays ("i robot").
  function normalise(title) {
    return (title || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\b[a-z](?: [a-z]\b)+/g, (run) => run.replace(/ /g, ''));
  }

  function open() {
    if (conn) return Promise.resolve(conn);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['titles_a', 'titles_b', 'episodes_a', 'episodes_b']) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'k' });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('ids')) db.createObjectStore('ids');
      };
      req.onsuccess = () => {
        conn = req.result;
        conn.onclose = () => { conn = null; };
        conn.onversionchange = () => { conn.close(); conn = null; };
        resolve(conn);
      };
      req.onerror = () => reject(req.error);
    });
  }

  const result = (r) => new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const complete = (tx) => new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('transaction aborted'));
  });

  const today = () => new Date().toISOString().slice(0, 10);

  async function getMeta() {
    const db = await open();
    return (await result(db.transaction('meta').objectStore('meta').get('info'))) || null;
  }

  async function putMeta(info) {
    const db = await open();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(info, 'info');
    await complete(tx);
  }

  async function status() {
    const m = await getMeta();
    return m
      ? {
          present: true,
          built: m.built,
          builtAt: m.builtAt,
          ratingsBuilt: m.ratingsBuilt || m.built,
          ratingsAt: m.ratingsAt || m.builtAt,
          minVotes: m.minVotes,
          titles: m.titles,
          episodes: m.episodes,
          episodesPending: !!m.episodesPending,
          unknown: m.unknown || 0,
          outdated: (m.format || 1) < FORMAT,
        }
      : { present: false };
  }

  // The current rating of one ID from the ids table, or null. The table is
  // empty until the first build of this format, so the entry's own copy is
  // the fallback.
  async function getCurrent(db, imdbID) {
    const row = await result(db.transaction('ids').objectStore('ids').get(imdbID));
    return Array.isArray(row) ? row : null;
  }

  const ratingsDate = (m) => m.ratingsBuilt || m.built;

  // Same result shape as the OMDb path, plus source: 'local'. Null when the
  // title is not in the database.
  // kind ('movie' | 'series' | null) filters; year (string | null) prefers
  // the entry released that year, give or take one, among several of the
  // same name (the 2026 series "East of Eden" over the 1955 film). Entries
  // are most-voted first, so without a year match the popular one wins.
  async function lookup(title, kind, year) {
    const m = await getMeta();
    if (!m) return null;
    const db = await open();
    const rec = await result(db.transaction(m.store).objectStore(m.store).get(normalise(title)));
    if (!rec || !rec.e.length) return null;
    const want = kind === 'movie' ? 'm' : kind === 'series' ? 's' : null;
    const pool = want ? rec.e.filter((e) => e[1] === want) : rec.e;
    const y = year ? Number(year) : NaN;
    const hit = (Number.isFinite(y) && pool.find((e) => e[2] != null && Math.abs(e[2] - y) <= 1)) || pool[0];
    if (!hit) return null;
    const [imdbID, type, startYear, rating, votes, primaryTitle] = hit;
    const cur = await getCurrent(db, imdbID);
    return {
      rating: cur ? cur[0] : rating,
      votes: (cur ? cur[1] : votes).toLocaleString('en-US'),
      year: startYear == null ? null : String(startYear),
      imdbID,
      kind: type === 'm' ? 'movie' : 'series',
      matchedTitle: primaryTitle || title,
      source: 'local',
      built: cur ? ratingsDate(m) : m.built,
    };
  }

  // The rating of a title by its IMDb ID, for titles the database knows no
  // name for (learned from OMDb, see background.js lookup): {rating, votes,
  // built} or null when the ids table lacks it.
  async function lookupById(imdbID) {
    const m = await getMeta();
    if (!m) return null;
    const cur = await getCurrent(await open(), imdbID);
    if (!cur) return null;
    return { rating: cur[0], votes: cur[1].toLocaleString('en-US'), built: ratingsDate(m) };
  }

  const episodeStore = (titleStore) => titleStore.replace('titles', 'episodes');

  // Ratings of one season of a series: { episode number: [rating, votes] },
  // or null when the database has none (no database, episodes not written
  // yet, or a season too new or too little voted on).
  async function lookupEpisodes(imdbID, season) {
    const m = await getMeta();
    if (!m || !m.episodes) return null;
    const db = await open();
    const store = episodeStore(m.store);
    const rec = await result(db.transaction(store).objectStore(store).get(imdbID));
    const list = rec && rec.s[String(season)];
    if (!list || !list.length) return null;
    const out = {};
    for (const [ep, rating, votes] of list) out[ep] = [rating, votes];
    return out;
  }

  // Writes records in batches, one transaction each, so a lookup can run in
  // between. put(store, item) adds one record. onProgress(done, total).
  async function writeBatches(db, name, items, put, onProgress, offset, total) {
    const BATCH = 2000;
    for (let i = 0; i < items.length; i += BATCH) {
      const tx = db.transaction(name, 'readwrite');
      const store = tx.objectStore(name);
      for (const item of items.slice(i, i + BATCH)) put(store, item);
      await complete(tx);
      if (onProgress) onProgress(offset + Math.min(i + BATCH, items.length), total);
    }
  }

  // Stage one of a full build: the title index (Map of normalised title ->
  // entries) and the ids table (Map of imdbID -> [rating, votes]) go into
  // the stores that are not live, then become live, with the episode store
  // of the new pair empty until writeEpisodes fills it. onProgress(done, total).
  async function writeTitles(index, ids, info, onProgress) {
    const db = await open();
    const old = await getMeta();
    const target = old && old.store === 'titles_a' ? 'titles_b' : 'titles_a';
    const epTarget = episodeStore(target);

    let tx = db.transaction([target, epTarget, 'ids'], 'readwrite');
    tx.objectStore(target).clear();
    tx.objectStore(epTarget).clear();
    tx.objectStore('ids').clear();
    await complete(tx);

    const keys = [...index.keys()];
    const idKeys = [...ids.keys()];
    const total = keys.length + idKeys.length;
    await writeBatches(db, target, keys, (s, k) => s.put({ k, e: index.get(k) }), onProgress, 0, total);
    await writeBatches(db, 'ids', idKeys, (s, k) => s.put(ids.get(k), k), onProgress, keys.length, total);

    await putMeta({
      ...info,
      store: target,
      keys: keys.length,
      ids: idKeys.length,
      unknown: 0,
      episodes: 0,
      episodesPending: true,
    });

    if (old && old.store !== target) {
      tx = db.transaction([old.store, episodeStore(old.store)], 'readwrite');
      tx.objectStore(old.store).clear();
      tx.objectStore(episodeStore(old.store)).clear();
      await complete(tx);
    }
  }

  // Stage two: the episodes (Map of series imdbID -> { season: [[ep, rating,
  // votes, imdbID]] }) into the live pair's episode store. onProgress(done, total).
  async function writeEpisodes(episodes, count, onProgress) {
    const db = await open();
    const m = await getMeta();
    if (!m) throw new Error('no database to add episodes to');
    const series = [...episodes.keys()];
    await writeBatches(db, episodeStore(m.store), series, (s, k) => s.put({ k, s: episodes.get(k) }), onProgress, 0, series.length);
    await putMeta({ ...m, episodes: count, episodesPending: false });
  }

  // The weekly pass: ratings (Map of imdbID -> [rating, votes], every row of
  // the ratings dump over the episode floor) replace the ids table's values
  // and the episode rows' ratings in place. IDs with minVotes or more votes
  // that the table has never seen are added, flagged nameless; the count of
  // those (since the last full build) is what decides when the full
  // rebuild is worth its download. Nothing here needs the big dumps.
  // Returns { unknown, changed, episodesChanged }. onProgress(done, total).
  async function updateRatings(ratings, minVotes, onProgress) {
    const m = await getMeta();
    if (!m) throw new Error('no database to update; use a full build');
    if ((m.format || 1) < FORMAT) throw new Error('the database needs a full rebuild first');
    const db = await open();

    // 1. Every current row, keys and values in the same order.
    let tx = db.transaction('ids');
    const idStore = tx.objectStore('ids');
    const [keys, vals] = await Promise.all([result(idStore.getAllKeys()), result(idStore.getAll())]);
    await complete(tx);

    const epName = episodeStore(m.store);
    tx = db.transaction(epName);
    const shows = await result(tx.objectStore(epName).getAll());
    await complete(tx);

    // 2. Rows whose rating or votes moved; nameless rows stay nameless.
    const puts = [];
    const seen = new Set(keys);
    let unknown = 0;
    for (let i = 0; i < keys.length; i++) {
      const old = vals[i];
      const nameless = old[2] === 1;
      if (nameless) unknown++;
      const r = ratings.get(keys[i]);
      if (!r || (old[0] === r[0] && old[1] === r[1])) continue;
      puts.push([keys[i], nameless ? [r[0], r[1], 1] : [r[0], r[1]]]);
    }
    // Episodes the database stores are known by their own IDs; a rated ID
    // outside both is new since the full build (a new title, or an episode
    // that aired after it).
    const episodeIds = new Set();
    for (const show of shows) for (const list of Object.values(show.s)) for (const row of list) if (row[3]) episodeIds.add(row[3]);
    let added = 0;
    for (const [id, r] of ratings) {
      if (r[1] < minVotes || seen.has(id) || episodeIds.has(id)) continue;
      puts.push([id, [r[0], r[1], 1]]);
      unknown++;
      added++;
    }

    // 3. Episode rows: update in place, rewrite only the series that changed.
    const dirty = [];
    for (const show of shows) {
      let changed = false;
      for (const list of Object.values(show.s)) {
        for (const row of list) {
          const r = row[3] && ratings.get(row[3]);
          if (!r || (row[1] === r[0] && row[2] === r[1])) continue;
          row[1] = r[0];
          row[2] = r[1];
          changed = true;
        }
      }
      if (changed) dirty.push(show);
    }

    // 4. Write.
    const total = puts.length + dirty.length;
    await writeBatches(db, 'ids', puts, (s, [k, v]) => s.put(v, k), onProgress, 0, total);
    await writeBatches(db, epName, dirty, (s, show) => s.put(show), onProgress, puts.length, total);
    if (onProgress) onProgress(total, total);

    await putMeta({ ...m, ratingsBuilt: today(), ratingsAt: Date.now(), unknown, ids: keys.length + added });
    return { unknown, changed: puts.length, episodesChanged: dirty.length };
  }

  // Empties every store and the meta record: the state of a fresh install.
  // The next Update now builds from scratch.
  async function clear() {
    const db = await open();
    const stores = ['meta', 'titles_a', 'titles_b', 'episodes_a', 'episodes_b', 'ids'];
    const tx = db.transaction(stores, 'readwrite');
    for (const s of stores) tx.objectStore(s).clear();
    await complete(tx);
  }

  return { FORMAT, normalise, open, getMeta, status, lookup, lookupById, lookupEpisodes, writeTitles, writeEpisodes, updateRatings, clear };
})();
