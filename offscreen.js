// Runs inside offscreen.html. The service worker can't do minutes of
// streaming work itself (Chrome stops idle workers), so it opens this hidden
// page, which runs the build in a web worker and relays progress back. In
// Firefox the page is a frame inside the background event page (see
// ensureOffscreen in background.js).

let worker = null;
let heartbeat = null;

// Every message the background receives keeps it awake (Firefox unloads an
// event page after about 30 idle seconds). Progress already arrives several
// times a second; this covers any stretch where the build reports nothing.
const HEARTBEAT_MS = 10 * 1000;

function stop() {
  worker.terminate();
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
      if (e.data.type === 'done' || e.data.type === 'error') stop();
    };
    worker.onerror = (e) => {
      chrome.runtime.sendMessage({ target: 'background', type: 'error', message: e.message || 'build worker failed' });
      stop();
    };
    heartbeat = setInterval(() => chrome.runtime.sendMessage({ target: 'background', type: 'heartbeat' }).catch(() => {}), HEARTBEAT_MS);
    worker.postMessage({ type: 'start', minVotes: msg.minVotes });
  }
});
