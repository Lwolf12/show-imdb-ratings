// The database build as the background sees it: its state in session
// storage (getBuildState), the hidden page that runs it (offscreen.html
// in Chrome, a frame of the event page in Firefox: ensureOffscreen),
// starting and cancelling a build, the messages it sends back
// (handleBuildMessage), and Delete database. The work itself is
// builder.js's. A background script; omdb.js says how they load.

const MIN_VOTES = 25;


async function getBuildState() {
  return (await chrome.storage.session.get('buildState')).buildState || { status: 'idle' };
}

async function setBuildState(state) {
  await chrome.storage.session.set({ buildState: state });
}

// Firefox: the build page in a frame of this event page. Firefox suspends an
// idle event page after about 30 seconds, but every message it receives
// resets that timer, and the build page sends progress several times a
// second (and a heartbeat, see offscreen.js), so the page stays up until the
// build ends.
const buildFrame = () => document.getElementById('build-frame');

async function hasBuildPage() {
  if (FIREFOX) return !!buildFrame();
  return chrome.offscreen.hasDocument();
}

async function ensureOffscreen() {
  if (FIREFOX) {
    if (buildFrame()) return;
    const frame = document.createElement('iframe');
    frame.id = 'build-frame';
    const loaded = new Promise((r) => frame.addEventListener('load', r, { once: true }));
    frame.src = chrome.runtime.getURL('offscreen.html');
    document.body.appendChild(frame);
    await loaded;
    return;
  }
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Builds the ratings database from IMDb data dumps in a web worker',
    });
  } catch (e) {
    if (!/already exists|single offscreen/i.test(String(e))) throw e;
  }
}

async function closeOffscreen() {
  if (FIREFOX) {
    buildFrame()?.remove();
    return;
  }
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  } catch (e) {
    /* nothing to close */
  }
}

// A build whose page is gone (the browser restarted, or Firefox unloaded the
// event page mid-build) would otherwise stay "running" until the browser
// restarts, with Update now greyed out. Checked whenever this script starts:
// in Chrome the offscreen page outlives a restart of the service worker, so a
// running build with its page still open is left alone.
recoverInterruptedBuild();

async function recoverInterruptedBuild() {
  const state = await getBuildState();
  if (state.status !== 'running' || (await hasBuildPage())) return;
  await setBuildState({ status: 'error', kind: state.kind, message: 'the build was interrupted; click Update now to start it again', at: Date.now() });
}

// Returns the build state after starting (or the current one if already
// running). kind: 'full' (the dumps), 'ratings' (the ratings dump into the
// existing database) or 'akas' (titles in more languages into it); see
// builder.js. langs: the languages to add (kind 'akas') or to have (full);
// the ones wanted (titleLanguages) when not given.
// One at a time: the alarm and a click on Update now can ask in the same
// moment, and both would find the state idle before either wrote it.
let buildStarting = Promise.resolve();

// fresh: a languages pass that reads a fresh list from IMDb even though
// the one kept covers the choice (the Refresh titles button).
function startBuild(trigger, kind = 'full', langs = null, { fresh = false } = {}) {
  const run = buildStarting.then(() => startBuildNow(trigger, kind, langs, fresh));
  buildStarting = run.catch(() => {});
  return run;
}

async function startBuildNow(trigger, kind, langs, fresh = false) {
  const state = await getBuildState();
  if (state.status === 'running') return state;
  const next = { status: 'running', trigger, kind, phase: 'starting', pct: 0, startedAt: Date.now() };
  await setBuildState(next);
  try {
    await ensureOffscreen();
    const start = {
      target: 'offscreen', type: 'build', kind, minVotes: MIN_VOTES, langs: langs || (await titleLanguages()),
      akasDays: (await refreshIntervals()).akasDays, // how old a kept list may get before a rebuild reads a fresh one
      fresh: fresh === true,
    };
    try {
      await chrome.runtime.sendMessage(start);
    } catch (e) {
      // A just-created offscreen page can miss the very first message.
      await new Promise((r) => setTimeout(r, 500));
      await chrome.runtime.sendMessage(start);
    }
  } catch (e) {
    const failed = { status: 'error', kind, message: String((e && e.message) || e), at: Date.now() };
    await setBuildState(failed);
    await closeOffscreen();
    return failed;
  }
  return next;
}

// The settings page's Cancel button. The worker stops at its next chance
// (builder.js cancel: a download at once, a save once it is through) and
// reports 'cancelled', handled below; until then the state says cancelling
// so the page can show it. The build page may still be coming up
// (startBuild), so the message is tried for a few seconds; the page keeps
// a cancel that beats the build message (offscreen.js). With nobody
// listening after that, the page is gone: the build was interrupted
// (recoverInterruptedBuild's case, mid-run), which the state says instead
// of staying "cancelling" with both buttons dead. Returns the build state.
async function cancelBuild() {
  const state = await getBuildState();
  if (state.status !== 'running' || state.cancelling) return state;
  const next = { ...state, cancelling: true };
  await setBuildState(next);
  const cancel = { target: 'offscreen', type: 'cancel' };
  for (let i = 0; i < 8; i++) {
    try {
      await chrome.runtime.sendMessage(cancel);
      return next;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const gone = !(await hasBuildPage());
  const after = gone
    ? { status: 'error', kind: state.kind, message: 'the build was interrupted; click Update now to start it again', at: Date.now() }
    : { ...state, cancelling: false }; // the page is there but deaf: the button comes back
  await setBuildState(after);
  if (gone) await closeOffscreen();
  return after;
}

// Messages from the build are handled one at a time, in arrival order. A
// progress update reads the state and writes it back; run concurrently, the
// last "100%" could land after "done" and leave the state stuck on running
// (Update now greyed out, no done message) until the browser restarts.
let buildMessages = Promise.resolve();

function onBuildMessage(msg) {
  buildMessages = buildMessages.then(() => handleBuildMessage(msg)).catch(() => {});
}

let badgePct = -1; // the whole percent the toolbar badge shows (updateBadge)

async function handleBuildMessage(msg) {
  if (msg.type === 'progress') {
    const state = await getBuildState();
    if (state.status !== 'running') return; // a late update after done/error
    await setBuildState({ ...state, phase: msg.phase, pct: msg.pct, detail: msg.detail });
    const pct = Math.round((msg.pct || 0) * 100);
    if (pct !== badgePct) {
      badgePct = pct;
      buildBadge(pct);
    }
  } else if (msg.type === 'usable') {
    // A full build's titles are live; the episodes are still streaming.
    const state = await getBuildState();
    if (state.status === 'running') await setBuildState({ ...state, usable: true });
    updateBadge();
  } else if (msg.type === 'done') {
    const state = await getBuildState();
    await setBuildState({ status: 'done', kind: msg.kind || state.kind || 'full', at: Date.now(), info: msg.info });
    await closeOffscreen();
    updateBadge();
    if (msg.kind === 'ratings') {
      console.info('[imdbext] ratings refreshed: ' + msg.info.changed.toLocaleString() + ' titles and ' +
        msg.info.episodesChanged.toLocaleString() + ' series changed; ' + msg.info.unknown.toLocaleString() +
        ' rated IDs have no name since the last full build');
    }
    if (msg.kind === 'akas') {
      console.info('[imdbext] titles in ' + ((msg.info.langs || []).join(', ') || 'no other language') + ': ' + (msg.info.akas || 0).toLocaleString() + ' keys');
    }
    if (msg.info && msg.info.akasError) {
      // A full build whose last step, refreshing the old akas extract,
      // failed: the titles and episodes are done and the languages still
      // key from the old extract, so the build is done; the next rebuild
      // fetches the file again.
      console.warn('[imdbext] the list of titles in other languages was not refreshed: ' + msg.info.akasError);
    }
    // A language tick or untick made while this build ran was held back
    // (applyLanguageChoice); it goes through now.
    applyLanguageChoice();
  } else if (msg.type === 'cancelled') {
    // Stopped by the Cancel button. saved: what a full build had already
    // made live ('titles': the episodes are pending, as the status line
    // says), or null when nothing changed.
    const state = await getBuildState();
    await setBuildState({ status: 'cancelled', kind: msg.kind || state.kind || 'full', saved: msg.saved || null, at: Date.now() });
    await closeOffscreen();
    updateBadge();
    if (state.kind !== 'akas') applyLanguageChoice();
  } else if (msg.type === 'error') {
    const state = await getBuildState();
    await setBuildState({ status: 'error', kind: state.kind, message: msg.message, at: Date.now() });
    await closeOffscreen();
    // Likewise after another kind of build failed; not after a failed
    // languages pass itself, which would only start it again at once.
    if (state.kind !== 'akas') applyLanguageChoice();
  }
}

// Settings > Advanced > Delete database: back to the no-database state, for
// OMDb-only use or to test a first build. Ratings remembered from the
// database go too (OMDb ones stay; a learned title whose rating came from
// the database counts as the database's), so nothing still shows from it.
// With no database the automatic refresh stays idle until Update now
// builds one again.
// "As if just installed": the database goes, and so does every remembered
// answer (ratings 'r:', OMDb season lists 'e:', extras 'x:'), whichever
// path gave it. Keeping OMDb's answers left cards showing ratings while
// previews, whose keys were never stored, said n/a. Returns how many
// ratings were forgotten.
async function deleteDatabase() {
  if ((await getBuildState()).status === 'running') return { ok: false, message: 'a build is running' };
  await RatingsDB.clear();
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => /^[rex]:/.test(k));
  if (keys.length) await chrome.storage.local.remove(keys);
  await setBuildState({ status: 'idle' });
  await updateBadge();
  return { ok: true, forgotten: keys.filter((k) => k.startsWith('r:')).length };
}
