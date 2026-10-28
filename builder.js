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
    const total = Number(res.headers.get('content-length')) || 0;
    let read = 0;
    const counter = new TransformStream({
      transform(chunk, ctrl) {
        read += chunk.byteLength;
        if (onBytes) onBytes(read, total);
        ctrl.enqueue(chunk);
      },
    });
    const reader = res.body
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

  // The full build.
  // onProgress({ phase: 'ratings'|'basics'|'writing'|'episodes'|'writing-episodes', pct: 0..1, detail })
  // onUsable(info) fires once the titles are live, before the episodes stream.
  async function build({ minVotes = 25, onProgress, onUsable } = {}) {
    const progress = (phase, pct, detail) => onProgress && onProgress({ phase, pct, detail });

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
    index.clear();
    ids.clear();
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
    return { ...info, episodes: episodeCount };
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

  return { build, refreshRatings };
})();
