// Runs inside offscreen.html. The service worker can't do minutes of
// streaming work itself (Chrome stops idle workers), so it opens this hidden
// page, which runs the build in a web worker and relays progress back. In
// Firefox the page is a frame inside the background event page (see
// ensureOffscreen in background.js).

let worker = null;
let heartbeat = null;
let cancelPending = false; // a cancel that arrived before the build did

// Every message the background receives keeps it awake (Firefox unloads an
// event page after about 30 idle seconds). Progress already arrives several
// times a second; this covers any stretch where the build reports nothing.
const HEARTBEAT_MS = 10 * 1000;

function stop() {
  worker?.terminate(); // onerror can follow a final message, both of which end here
  worker = null;
  clearInterval(heartbeat);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.type === 'build') {
    if (worker) return; // already building
    worker = new Worker('build-worker.js');
    worker.onmessage = (e) => {
      chrome.runtime.sendMessage({ target: 'background', ...e.data });
      if (['done', 'cancelled', 'error'].includes(e.data.type)) stop();
    };
    worker.onerror = (e) => {
      chrome.runtime.sendMessage({ target: 'background', type: 'error', message: e.message || 'build worker failed' });
      stop();
    };
    heartbeat = setInterval(() => chrome.runtime.sendMessage({ target: 'background', type: 'heartbeat' }).catch(() => {}), HEARTBEAT_MS);
    worker.postMessage({ type: 'start', kind: msg.kind, minVotes: msg.minVotes, langs: msg.langs || [] });
    if (cancelPending) worker.postMessage({ type: 'cancel' });
    cancelPending = false;
  }
  // The settings page's Cancel button: the worker stops at its next chance
  // and reports 'cancelled' (build-worker.js), which ends it as above. A
  // cancel that beats the build message (a click in the first second) is
  // kept for it.
  if (msg.type === 'cancel') {
    if (worker) worker.postMessage({ type: 'cancel' });
    else cancelPending = true;
  }
});
