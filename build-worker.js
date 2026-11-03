// Web worker that runs a database build off the main thread. Spawned by
// offscreen.js; reports progress, the titles going live (a full build),
// completion, a cancel and errors with postMessage. kind: 'full' (the
// dumps), 'ratings' (the ratings dump into the existing database) or
// 'akas' (titles in more languages into the existing database). langs:
// the languages besides English to match titles in (background.js
// titleLanguages). A 'cancel' message stops the run at its next chance
// (RatingsBuilder.cancel): the reply says what it had already saved.

importScripts('db.js', 'builder.js');

self.onmessage = (e) => {
  if (!e.data) return;
  if (e.data.type === 'cancel') RatingsBuilder.cancel();
  if (e.data.type === 'start') run(e.data);
};

async function run(data) {
  const kind = ['ratings', 'akas'].includes(data.kind) ? data.kind : 'full';
  let last = 0;
  try {
    const run = { ratings: RatingsBuilder.refreshRatings, akas: RatingsBuilder.addLanguages }[kind] || RatingsBuilder.build;
    const info = await run({
      minVotes: data.minVotes,
      langs: Array.isArray(data.langs) ? data.langs : [],
      onProgress: (p) => {
        // Byte-level progress fires very often; a few updates a second is plenty.
        const now = Date.now();
        if (p.phase.startsWith('writing') || p.phase === 'updating' || now - last > 250) {
          last = now;
          self.postMessage({ type: 'progress', ...p });
        }
      },
      onUsable: (info) => self.postMessage({ type: 'usable', info }),
    });
    self.postMessage({ type: 'done', kind, info });
  } catch (err) {
    if (err && err.cancelled) self.postMessage({ type: 'cancelled', kind, saved: err.saved || null });
    else self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
}
