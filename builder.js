// Builds the local ratings database inside the browser from IMDb's public
// data dumps (https://developer.imdb.com/non-commercial-datasets/), which
// IMDb licenses for each person's own use. Runs in build-worker.js (a web
// worker inside the offscreen document). Needs RatingsDB from db.js.
//
// build(): the full build. Streams title.ratings.tsv.gz (~9 MB),
// title.basics.tsv.gz (~220 MB) and title.episode.tsv.gz (~55 MB) through
// gzip decompression line by line, keeps films (with TV films, specials,
// direct-to-video and shorts; see TYPE) and series with at least minVotes
// votes and the episodes of those series with at least EPISODE_MIN_VOTES
// votes. The titles go live (RatingsDB.writeTitles) before the episodes
// stream, so a first install shows ratings after the basics pass.
//
// refreshRatings(): the weekly pass. Streams only title.ratings.tsv.gz and
// hands it to RatingsDB.updateRatings, which refreshes every stored rating
// and counts the titles rated since the last full build.
//
// addLanguages(): titles in other languages for an existing database.
// IMDb's title.akas.tsv.gz (~520 MB) holds every title's name in every
// language; downloadAkas streams it once and keeps the useful part (the
// database's titles, in the languages db.js LANGUAGES knows) as a gzip'd
// extract of about 50 MB in the database (RatingsDB.putFile), and
// keyFromExtract turns that into keys for the languages chosen, in
// seconds. So choosing another language later costs no download; the
// full build fetches the file again only once the extract is AKAS_DAYS
// old (RatingsDB.akasStale), and keys the chosen languages from the
// extract each time it rebuilds the titles.

const RatingsBuilder = (() => {
  'use strict';

  const BASE = 'https://datasets.imdbws.com/';
  // Everything a streaming site offers as a film counts as 'm': features, TV
  // films, direct-to-video ("Mike's New Car"), TV specials and TV shorts
  // (the Peanuts specials) and shorts (Pixar's "Piper"). Shorts have generic
  // names ("Spinning", "Hiccups") and many barely-watched entries, so they
  // need SHORT_MIN_VOTES; real ones on a streaming site have thousands.
  const TYPE = {
    movie: 'm',
    tvMovie: 'm',
    video: 'm',
    tvSpecial: 'm',
    tvShort: 'm',
    short: 'm',
    tvSeries: 's',
    tvMiniSeries: 's',
  };
  const SHORT_MIN_VOTES = 100;
  // Episodes get fewer votes than shows; 10 keeps ~700k episodes of ~35k
  // series (25 would drop to ~420k), still enough votes to mean something.
  const EPISODE_MIN_VOTES = 10;

  // Yields decompressed lines; reports compressed bytes read for progress.
  async function* lines(url, onBytes) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
    yield* linesFrom(res.body, Number(res.headers.get('content-length')) || 0, onBytes);
  }

  // The same over any stream of gzip'd text (a Blob's, say).
  async function* linesFrom(body, total, onBytes) {
    let read = 0;
    const counter = new TransformStream({
      transform(chunk, ctrl) {
        read += chunk.byteLength;
        if (onBytes) onBytes(read, total);
        ctrl.enqueue(chunk);
      },
    });
    const reader = body
      .pipeThrough(counter)
      .pipeThrough(new DecompressionStream('gzip'))
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += value;
      let start = 0;
      let nl;
      while ((nl = buf.indexOf('\n', start)) >= 0) {
        yield buf.slice(start, nl);
        start = nl + 1;
      }
      buf = buf.slice(start);
    }
    if (buf) yield buf;
  }

  function add(index, key, entry) {
    if (!key) return;
    const list = index.get(key);
    if (!list) index.set(key, [entry]);
    else if (!list.some((e) => e[0] === entry[0])) list.push(entry);
  }

  // tconst -> [rating, votes] for every title over the lower (episode) floor.
  async function readRatings(minVotes, progress) {
    const floor = Math.min(minVotes, EPISODE_MIN_VOTES);
    const ratings = new Map();
    let first = true;
    for await (const line of lines(BASE + 'title.ratings.tsv.gz', (r, t) => progress('ratings', t ? r / t : 0))) {
      if (first) { first = false; continue; }
      const t1 = line.indexOf('\t');
      const t2 = line.indexOf('\t', t1 + 1);
      const votes = Number(line.slice(t2 + 1));
      if (votes >= floor) ratings.set(line.slice(0, t1), [Number(line.slice(t1 + 1, t2)), votes]);
    }
    return ratings;
  }

  // The useful part of title.akas.tsv.gz (~520 MB, the biggest of the
  // dumps), as a gzip'd Blob of "imdbID\ttitle\tregion\tlanguage" lines:
  // the rows of titles the database has (byId), in any language or region
  // db.js LANGUAGES knows. Only what IMDb shows as the title there (types
  // imdbDisplay, or none): working, festival and DVD titles, and rows with
  // an attribute ("literal title", "fake working title") are left out,
  // since a streaming site shows none of those. The original title is a
  // key already. About 4 million rows, 50 MB compressed.
  async function downloadAkas(byId, progress) {
    const langs = new Set(Object.keys(RatingsDB.LANGUAGES));
    const regions = new Set();
    for (const list of Object.values(RatingsDB.LANGUAGES)) for (const r of list) regions.add(r);
    const gzip = new CompressionStream('gzip');
    const parts = [];
    // Drains the compressed side as it comes; an abort below ends it too.
    const collect = (async () => {
      const reader = gzip.readable.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
    })().catch(() => {});
    const writer = gzip.writable.getWriter();
    const encoder = new TextEncoder();
    let buf = '';
    let count = 0;
    let first = true;
    let finished = false;
    try {
      for await (const line of lines(BASE + 'title.akas.tsv.gz', (r, t) => progress('akas', t ? r / t : 0, count))) {
        if (first) { first = false; continue; }
        const t1 = line.indexOf('\t');
        if (!byId.has(line.slice(0, t1))) continue;
        // titleId, ordering, title, region, language, types, attributes, isOriginalTitle
        const f = line.split('\t');
        if (f[7] === '1') continue;
        if (!langs.has(f[4]) && !regions.has(f[3])) continue;
        if (f[5] !== '\\N' && f[5] !== 'imdbDisplay') continue;
        if (f[6] !== '\\N') continue;
        buf += f[0] + '\t' + f[2] + '\t' + f[3] + '\t' + f[4] + '\n';
        count++;
        if (buf.length > 1 << 20) {
          await writer.write(encoder.encode(buf));
          buf = '';
        }
      }
      if (buf) await writer.write(encoder.encode(buf));
      await writer.close();
      await collect;
      finished = true;
    } finally {
      // A dropped connection: let the streams and the parts go now rather
      // than when the worker is terminated.
      if (!finished) {
        parts.length = 0;
        writer.abort().catch(() => {});
      }
    }
    return new Blob(parts, { type: 'application/gzip' });
  }

  // Keys for the languages langs from the extract: a Map of normalised
  // title -> entries like the title index, for the titles in byId.
  async function keyFromExtract(blob, langs, byId, progress) {
    const want = new Set(langs);
    const regions = new Set();
    for (const l of langs) for (const r of RatingsDB.LANGUAGES[l] || []) regions.add(r);
    const extra = new Map();
    let count = 0;
    for await (const line of linesFrom(blob.stream(), blob.size, (r, t) => progress('keying', t ? r / t : 0, count))) {
      // imdbID, title, region, language
      const f = line.split('\t');
      if (f.length < 4) continue;
      if (!want.has(f[3]) && !regions.has(f[2])) continue;
      const entry = byId.get(f[0]);
      if (!entry) continue;
      const key = RatingsDB.normalise(f[1]);
      if (!key) continue;
      const list = extra.get(key);
      if (!list) extra.set(key, [entry]);
      else if (!list.some((e) => e[0] === entry[0])) list.push(entry);
      else continue;
      count++;
    }
    for (const list of extra.values()) list.sort((a, b) => b[4] - a[4]);
    return extra;
  }

  // The chosen languages into the live akas store, from the extract on
  // hand, or from a fresh download of the file when there is none or it
  // is old (or when told to). Returns { akas, langs } from writeAkas.
  async function applyLanguages(langs, byId, progress, download) {
    let blob = download ? null : await RatingsDB.getFile();
    if (!blob) {
      blob = await downloadAkas(byId, progress);
      await RatingsDB.putFile(blob);
    }
    const extra = await keyFromExtract(blob, langs, byId, progress);
    progress('writing-akas', 0);
    return RatingsDB.writeAkas(extra, langs, (done, total) => progress('writing-akas', total ? done / total : 1));
  }

  // The full build. langs: the languages besides English the user chose
  // (background.js titleLanguages); their keys are made again from the
  // extract right after the titles go live, and the akas file is fetched
  // again, last, once the extract on hand is old (db.js akasStale). With
  // no extract nothing is fetched: that is the Get titles button's job
  // (addLanguages), so no rebuild downloads the 520 MB by itself.
  // onProgress({ phase: 'ratings'|'basics'|'writing'|'episodes'|'writing-episodes'|'akas'|'keying'|'writing-akas', pct: 0..1, detail })
  // onUsable(info) fires once the titles are live, before the episodes stream.
  async function build({ minVotes = 25, langs = [], onProgress, onUsable } = {}) {
    const progress = (phase, pct, detail) => onProgress && onProgress({ phase, pct, detail });
    const fetchAkas = langs.length > 0 && RatingsDB.akasStale(await RatingsDB.getMeta());

    // 1. Ratings.
    const ratings = await readRatings(minVotes, progress);

    // 2. Walk basics, keep rated movies/series, index by normalised title.
    //    The ids table takes every rated title that is not an episode, kept
    //    or not, so the weekly pass can tell a new title from one it has
    //    seen before (db.js updateRatings). Rated episodes are noted, and
    //    those the episode pass does not store (their series is not kept)
    //    join the table afterwards for the same reason; so does a rated ID
    //    with no basics row at all. Without that, the first weekly pass
    //    would report a few thousand "new" titles right after a build.
    const index = new Map();
    const ids = new Map();
    const seriesIds = new Set();
    const episodeIds = new Set(); // rated episodes (minVotes), not yet stored
    let kept = 0;
    let first = true;
    for await (const line of lines(BASE + 'title.basics.tsv.gz', (r, t) => progress('basics', t ? r / t : 0, kept))) {
      if (first) { first = false; continue; }
      const t1 = line.indexOf('\t');
      const r = ratings.get(line.slice(0, t1));
      if (!r || r[1] < minVotes) continue;
      const f = line.split('\t');
      if (f[1] !== 'tvEpisode') ids.set(f[0], [r[0], r[1]]);
      else episodeIds.add(f[0]);
      const type = TYPE[f[1]];
      if (!type) continue;
      if (f[1] === 'short' && r[1] < SHORT_MIN_VOTES) continue;
      if (type === 's') seriesIds.add(f[0]);
      const entry = [f[0], type, f[5] === '\\N' ? null : Number(f[5]), r[0], r[1], f[2]];
      kept++;
      add(index, RatingsDB.normalise(f[2]), entry);
      if (f[3] !== f[2]) add(index, RatingsDB.normalise(f[3]), entry);
    }
    for (const list of index.values()) list.sort((a, b) => b[4] - a[4]);
    for (const [id, r] of ratings) {
      if (r[1] >= minVotes && !ids.has(id) && !episodeIds.has(id)) ids.set(id, [r[0], r[1]]); // no basics row
    }

    // 3. Titles go live now: badges can start while the episodes download.
    progress('writing', 0);
    const day = new Date().toISOString().slice(0, 10);
    const info = {
      built: day,
      builtAt: Date.now(),
      ratingsBuilt: day,
      ratingsAt: Date.now(),
      minVotes,
      titles: kept,
      format: RatingsDB.FORMAT,
    };
    await RatingsDB.writeTitles(index, ids, info, (done, total) => progress('writing', total ? done / total : 1));
    // The akas rows name titles by ID; the entries stay (the same arrays,
    // no copies) while the index's keys go.
    const byId = new Map();
    if (langs.length) for (const list of index.values()) for (const e of list) if (!byId.has(e[0])) byId.set(e[0], e);
    index.clear();
    ids.clear();
    // The chosen languages, from the extract on hand (even an old one, to
    // be refreshed at the end): seconds, so they are back before the
    // titles are announced live.
    let akas = null;
    if (langs.length && (await RatingsDB.getFile())) akas = await applyLanguages(langs, byId, progress, false);
    if (onUsable) onUsable({ ...info, episodes: 0 });

    // 4. Episodes of those series: series id -> { season: [[ep, rating, votes, id]] }.
    //    Columns: tconst, parentTconst, seasonNumber, episodeNumber.
    const episodes = new Map();
    let episodeCount = 0;
    first = true;
    for await (const line of lines(BASE + 'title.episode.tsv.gz', (r, t) => progress('episodes', t ? r / t : 0, episodeCount))) {
      if (first) { first = false; continue; }
      const f = line.split('\t');
      if (!seriesIds.has(f[1])) continue;
      const r = ratings.get(f[0]);
      if (!r || r[1] < EPISODE_MIN_VOTES) continue;
      const season = Number(f[2]);
      const ep = Number(f[3]);
      if (!Number.isInteger(season) || !Number.isInteger(ep)) continue; // '\N': unknown
      let show = episodes.get(f[1]);
      if (!show) episodes.set(f[1], (show = {}));
      (show[season] || (show[season] = [])).push([ep, r[0], r[1], f[0]]);
      episodeIds.delete(f[0]);
      episodeCount++;
    }
    for (const show of episodes.values()) for (const list of Object.values(show)) list.sort((a, b) => a[0] - b[0]);
    // Rated episodes that found no kept series: known to the ids table.
    const leftover = new Map();
    for (const id of episodeIds) leftover.set(id, ratings.get(id));
    episodeIds.clear();
    ratings.clear();

    // 5. Episodes into the live database.
    progress('writing-episodes', 0);
    await RatingsDB.writeEpisodes(episodes, episodeCount, (done, total) => progress('writing-episodes', total ? done / total : 1), leftover);
    episodes.clear();

    // 6. A fresh akas extract, last: everything above works without it,
    //    and most people need none. A failure here is not the build's:
    //    the titles and episodes are in, and the languages still key from
    //    the old extract (step 3), so the build is done and the next
    //    rebuild tries the file again. The result says so (akasError).
    let akasError = null;
    if (fetchAkas) {
      try {
        akas = await applyLanguages(langs, byId, progress, true);
      } catch (e) {
        akasError = String((e && e.message) || e);
      }
    }
    byId.clear();
    return { ...info, episodes: episodeCount, ...(akas || {}), ...(akasError ? { akasError } : {}) };
  }

  // The chosen languages for an existing database (the settings page's
  // language list, or its Download button): from the extract on hand, or
  // the file when there is none. download: fetch the file even so (not
  // used by the settings page today; the full rebuild refreshes it).
  // onProgress({ phase: 'akas'|'keying'|'writing-akas', pct, detail })
  // Returns { akas, langs } from RatingsDB.writeAkas.
  async function addLanguages({ langs = [], download = false, onProgress } = {}) {
    const progress = (phase, pct, detail) => onProgress && onProgress({ phase, pct, detail });
    if (!langs.length) {
      // None chosen: the keys go, the extract stays for next time.
      return RatingsDB.writeAkas(new Map(), [], null);
    }
    const byId = await RatingsDB.readEntries();
    const out = await applyLanguages(langs, byId, progress, download);
    byId.clear();
    return out;
  }

  // The weekly pass: ratings dump only, into the existing database.
  // onProgress({ phase: 'ratings'|'updating', pct, detail })
  // Returns { unknown, changed, episodesChanged } from RatingsDB.updateRatings.
  async function refreshRatings({ minVotes = 25, onProgress } = {}) {
    const progress = (phase, pct, detail) => onProgress && onProgress({ phase, pct, detail });
    const ratings = await readRatings(minVotes, progress);
    progress('updating', 0);
    const info = await RatingsDB.updateRatings(ratings, minVotes, (done, total) => progress('updating', total ? done / total : 1));
    ratings.clear();
    return info;
  }

  return { build, refreshRatings, addLanguages };
})();
