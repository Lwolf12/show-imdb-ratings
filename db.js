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
//   akas_a, akas_b  same shape as titles_a/_b: titles in other languages
//             for the languages in meta.langs (the user's choice), keyed
//             like the titles and pointing at the same entries. Looked up
//             after the title store misses. Paired and flipped with
//             titles_a/_b; a build keys them again from the extract below.
//   files     key 'akas' -> Blob: the useful part of IMDb's title.akas
//             file (builder.js downloadAkas), gzip'd lines of
//             "imdbID, title, region, language" for every title in the
//             database in every language LANGUAGES knows, about 50 MB.
//             Kept so a language chosen later is keyed from it in seconds
//             instead of downloading the 520 MB file again; meta.akasAt
//             and akasSize say when it was fetched and how big it is. A
//             full build fetches it again once it is AKAS_DAYS old.
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
  const VERSION = 5; // 2 added the episode stores, 3 the ids store, 4 the akas stores, 5 the files store
  let conn = null;

  // Languages whose titles can be added from IMDb's title.akas file, with
  // the regions whose rows carry them (most rows name a region, not a
  // language). Only languages written in the Latin alphabet: normalise
  // keeps a-z and digits, so Cyrillic, Greek or Japanese titles would come
  // out as empty keys. English needs nothing: the primary and original
  // titles are already keys.
  const LANGUAGES = {
    pl: ['PL'],
    de: ['DE', 'AT', 'CH'],
    fr: ['FR', 'BE', 'CA', 'CH'],
    es: ['ES', 'MX', 'AR', 'CO', 'CL', 'PE'],
    pt: ['PT', 'BR'],
    it: ['IT'],
    nl: ['NL', 'BE'],
    sv: ['SE'],
    da: ['DK'],
    nb: ['NO'],
    no: ['NO'],
    fi: ['FI'],
    cs: ['CZ'],
    sk: ['SK'],
    hu: ['HU'],
    ro: ['RO'],
    hr: ['HR'],
    sl: ['SI'],
    lt: ['LT'],
    lv: ['LV'],
    et: ['EE'],
    is: ['IS'],
    tr: ['TR'],
    id: ['ID'],
    ms: ['MY'],
    vi: ['VN'],
    ca: ['ES'],
  };

  // What the stored keys were built with. A database of an older format is
  // rebuilt once after an update (background.js maybeRefresh).
  //   1  movies, TV films and series; plain normalise
  //   2  also direct-to-video, TV specials, TV shorts and shorts (builder.js
  //      TYPE), and abbreviations joined in normalise
  //   3  the ids table and episode rows carrying their imdbID, which the
  //      weekly ratings-only pass needs
  const FORMAT = 3;

  // How old the akas extract may be before a full build fetches the file
  // again. Titles get new translations rarely, and the file costs more
  // than the other three together.
  const AKAS_DAYS = 90;

  // Whether the extract on hand is older than AKAS_DAYS, so a full build
  // that wants any language fetches the file again. A missing extract is
  // not stale: the 520 MB is only ever the settings page's Get titles
  // button, never a rebuild running by itself. Shared by builder.js and
  // background.js (refreshPlan), which says what the build downloads.
  function akasStale(meta) {
    return !!(meta && meta.akasAt) && Date.now() - meta.akasAt > AKAS_DAYS * 24 * 60 * 60 * 1000;
  }

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
        for (const s of ['titles_a', 'titles_b', 'episodes_a', 'episodes_b', 'akas_a', 'akas_b']) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'k' });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('ids')) db.createObjectStore('ids');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
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
          langs: m.langs || [],
          akasAt: m.akasAt || 0,
          akasSize: m.akasSize || 0,
          akas: m.akas || 0,
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
  // akas: whether titles in other languages (the akas store) count too;
  // background.js passes the user's choice.
  async function lookup(title, kind, year, akas = true) {
    const m = await getMeta();
    if (!m) return null;
    const db = await open();
    const key = normalise(title);
    let rec = await result(db.transaction(m.store).objectStore(m.store).get(key));
    // Not an English title: maybe one in a language the akas store has.
    // Such an answer is marked (aka), so the settings page can forget the
    // remembered ones when the languages are turned off.
    let aka = false;
    if (!rec && akas && (m.langs || []).length) {
      rec = await result(db.transaction(akasStore(m.store)).objectStore(akasStore(m.store)).get(key));
      aka = !!rec;
    }
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
      ...(aka ? { aka: true } : {}),
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
  const akasStore = (titleStore) => titleStore.replace('titles', 'akas');

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
  // entries) goes into the title store that is not live, in batches; then
  // the ids table (Map of imdbID -> [rating, votes]) and the switch to the
  // new pair land in one transaction, so lookups see the old database until
  // it commits and the new one after, nothing in between. The new pair's
  // episode store is empty until writeEpisodes fills it. A cancel during
  // the batches (onProgress throwing, builder.js) changes nothing live;
  // clearSpare drops what the batches wrote. onProgress(done, total).
  // The new pair's akas store starts empty (the builder keys the chosen
  // languages again from the extract right after); the extract itself,
  // in files, is not part of the pair and stays, as do its meta fields.
  async function writeTitles(index, ids, info, onProgress) {
    const db = await open();
    const old = await getMeta();
    const target = old && old.store === 'titles_a' ? 'titles_b' : 'titles_a';
    const epTarget = episodeStore(target);
    const akTarget = akasStore(target);

    let tx = db.transaction([target, epTarget, akTarget], 'readwrite');
    tx.objectStore(target).clear();
    tx.objectStore(epTarget).clear();
    tx.objectStore(akTarget).clear();
    await complete(tx);

    const keys = [...index.keys()];
    const idKeys = [...ids.keys()];
    const total = keys.length + idKeys.length;
    await writeBatches(db, target, keys, (s, k) => s.put({ k, e: index.get(k) }), onProgress, 0, total);

    // The ids and the switch, atomically. The puts go in chunks, each
    // awaited before the next is issued, which keeps the transaction open
    // (a request is always pending) without queuing them all at once.
    tx = db.transaction(['ids', 'meta'], 'readwrite');
    const idStore = tx.objectStore('ids');
    idStore.clear();
    const CHUNK = 5000;
    for (let i = 0; i < idKeys.length; i += CHUNK) {
      let last = null;
      for (const k of idKeys.slice(i, i + CHUNK)) last = idStore.put(ids.get(k), k);
      if (last) await result(last);
    }
    tx.objectStore('meta').put({
      ...info,
      store: target,
      keys: keys.length,
      ids: idKeys.length,
      unknown: 0,
      episodes: 0,
      episodesPending: true,
      langs: [],
      akas: 0,
      akasAt: (old && old.akasAt) || 0,
      akasSize: (old && old.akasSize) || 0,
    }, 'info');
    await complete(tx);
    if (onProgress) onProgress(total, total);

    if (old && old.store !== target) {
      tx = db.transaction([old.store, episodeStore(old.store), akasStore(old.store)], 'readwrite');
      tx.objectStore(old.store).clear();
      tx.objectStore(episodeStore(old.store)).clear();
      tx.objectStore(akasStore(old.store)).clear();
      await complete(tx);
    }
  }

  // The pair that is not live, emptied: what a cancelled writeTitles left
  // in it (the next build would clear it anyway, but that may be a month
  // off and this is up to a few hundred MB).
  async function clearSpare() {
    const db = await open();
    const m = await getMeta();
    const spare = m && m.store === 'titles_a' ? 'titles_b' : 'titles_a';
    const tx = db.transaction([spare, episodeStore(spare), akasStore(spare)], 'readwrite');
    tx.objectStore(spare).clear();
    tx.objectStore(episodeStore(spare)).clear();
    tx.objectStore(akasStore(spare)).clear();
    await complete(tx);
  }

  // Every entry of the live title store by imdbID, for an akas pass on its
  // own (builder.js addLanguages): the akas rows name titles by ID.
  async function readEntries() {
    const m = await getMeta();
    if (!m || !m.store) throw new Error('no database to add titles to');
    const db = await open();
    const tx = db.transaction(m.store);
    const rows = await result(tx.objectStore(m.store).getAll());
    await complete(tx);
    const byId = new Map();
    for (const row of rows) for (const e of row.e) if (!byId.has(e[0])) byId.set(e[0], e);
    return byId;
  }

  // Alternate titles (Map of normalised title -> entries, builder.js
  // keyFromExtract, for the languages langs) replace the live pair's akas
  // store, and langs become meta.langs. Replacing, not merging: the Map
  // is the whole chosen set, so a language unticked disappears too.
  // onProgress(done, total).
  async function writeAkas(extra, langs, onProgress) {
    const db = await open();
    const m = await getMeta();
    if (!m || !m.store) throw new Error('no database to add titles to');
    const name = akasStore(m.store);
    let tx = db.transaction(name, 'readwrite');
    tx.objectStore(name).clear();
    await complete(tx);
    const keys = [...extra.keys()];
    await writeBatches(db, name, keys, (s, k) => s.put({ k, e: extra.get(k) }), onProgress, 0, keys.length);
    if (onProgress) onProgress(keys.length, keys.length);
    const cur = (await getMeta()) || m; // the episode stage may have moved on meanwhile
    await putMeta({ ...cur, langs: [...langs], akas: keys.length });
    return { akas: keys.length, langs: [...langs] };
  }

  // The akas extract (see files in the layout): putFile stores a fresh
  // one and notes when and how big; getFile returns it or null.
  async function putFile(blob) {
    const db = await open();
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(blob, 'akas');
    await complete(tx);
    const m = await getMeta();
    if (m) await putMeta({ ...m, akasAt: Date.now(), akasSize: blob.size });
  }

  async function getFile() {
    const db = await open();
    const tx = db.transaction('files');
    const blob = await result(tx.objectStore('files').get('akas'));
    await complete(tx);
    return blob || null;
  }

  // "Match titles in other languages" switched off: the keys go, so nothing
  // matches; the kept extract stays (akasAt, akasSize untouched), so
  // switching back on keys the languages again with no download. Only
  // clear() removes the extract.
  async function clearAkas() {
    const db = await open();
    const tx = db.transaction(['akas_a', 'akas_b'], 'readwrite');
    tx.objectStore('akas_a').clear();
    tx.objectStore('akas_b').clear();
    await complete(tx);
    const m = await getMeta();
    if (m) await putMeta({ ...m, langs: [], akas: 0 });
  }

  // Stage two: the episodes (Map of series imdbID -> { season: [[ep, rating,
  // votes, imdbID]] }) into the live pair's episode store, and extraIds
  // (Map of imdbID -> [rating, votes]: rated episodes with no kept series)
  // into the ids table, so the ratings pass does not take them for new.
  // onProgress(done, total).
  async function writeEpisodes(episodes, count, onProgress, extraIds = null) {
    const db = await open();
    const m = await getMeta();
    if (!m) throw new Error('no database to add episodes to');
    const series = [...episodes.keys()];
    const extra = extraIds ? [...extraIds.keys()] : [];
    const total = series.length + extra.length;
    await writeBatches(db, episodeStore(m.store), series, (s, k) => s.put({ k, s: episodes.get(k) }), onProgress, 0, total);
    await writeBatches(db, 'ids', extra, (s, k) => s.put(extraIds.get(k), k), onProgress, series.length, total);
    await putMeta({ ...m, episodes: count, episodesPending: false, ids: (m.ids || 0) + extra.length });
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
    const stores = ['meta', 'titles_a', 'titles_b', 'episodes_a', 'episodes_b', 'akas_a', 'akas_b', 'files', 'ids'];
    const tx = db.transaction(stores, 'readwrite');
    for (const s of stores) tx.objectStore(s).clear();
    await complete(tx);
  }

  return { FORMAT, LANGUAGES, AKAS_DAYS, akasStale, normalise, open, getMeta, status, lookup, lookupById, lookupEpisodes, writeTitles, clearSpare, writeEpisodes, readEntries, writeAkas, putFile, getFile, clearAkas, updateRatings, clear };
})();
