// Web worker that runs a database build off the main thread. Spawned by
// offscreen.js; reports progress, the titles going live (a full build),
// completion and errors with postMessage. kind: 'full' (the three dumps) or
// 'ratings' (the ratings dump into the existing database).

importScripts('db.js', 'builder.js');

self.onmessage = async (e) => {
  if (!e.data || e.data.type !== 'start') return;
  const kind = e.data.kind === 'ratings' ? 'ratings' : 'full';
  let last = 0;
  try {
    const run = kind === 'ratings' ? RatingsBuilder.refreshRatings : RatingsBuilder.build;
    const info = await run({
      minVotes: e.data.minVotes,
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
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
