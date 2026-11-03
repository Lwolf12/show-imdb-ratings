const $ = (id) => document.getElementById(id);

function say(text, cls) {
  const s = $('status');
  s.textContent = text;
  s.className = cls || 'ok';
}

const STALE_WORKER =
  'The extension’s background worker is out of date. On chrome://extensions, click the reload icon on this extension’s card, then reopen this panel.';

const PHASES = {
  starting: 'Starting…',
  ratings: 'Downloading ratings',
  basics: 'Downloading title list',
  episodes: 'Downloading episode list',
  writing: 'Saving titles to the database',
  'writing-episodes': 'Saving episodes to the database',
  updating: 'Updating ratings in the database',
  akas: 'Reading IMDb’s list of titles by country (520 MB pass through; about 50 MB kept)',
  keying: 'Matching titles in the chosen languages',
  'writing-akas': 'Saving titles in other languages',
};
// The one phase Cancel waits out: the akas store is emptied before it is
// written, so that save runs through (builder.js cancel); every other
// phase stops where it is.
const SAVING_PHASE = 'writing-akas';

// "Polish", "Polish and German", "Polish, German and French".
function languageNames(langs) {
  let names;
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'language' });
    names = (langs || []).map((l) => dn.of(l) || l);
  } catch (e) {
    names = [...(langs || [])];
  }
  if (names.length < 2) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

function ago(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago';
}

// "due now" or "due Sunday, Nov 2".
function due(ts) {
  if (ts <= Date.now()) return 'due now';
  return 'due ' + new Date(ts).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

const WAITING = (n) => n.toLocaleString() + ' newly rated title' + (n === 1 ? '' : 's') + ' waiting for the full rebuild';

// The refresh intervals (background.js schedule) as words.
const EVERY = { 0: 'only when you click Update now', 7: 'weekly', 14: 'every two weeks', 30: 'monthly', 61: 'every two months', 91: 'every three months' };

// What the automatic refresh does with the intervals in force.
function scheduleText(s) {
  return 'ratings ' + EVERY[s.ratingsDays] + ' (reads 9 MB), the full title list ' + EVERY[s.fullDays] + ' (reads 280 MB)';
}

// ------------------------------------------------------------ database

// The green "All set" box is for a build that just finished; the session
// keeps the done state until the browser restarts, and an hours-old one is
// already covered by the "built today" line above.
const DONE_RECENT_MS = 10 * 60 * 1000;

// The ratings-only pass (Advanced) needs a finished full build of the
// current format to update; refreshStats says whether there is one.
let ratingsPassOk = false;
// "OMDb only" chosen (background.js omdbOnly): the build and refresh
// controls are greyed, since no database is built or consulted.
let omdbOnlyMode = false;
let dbPresent = false;
let loadedLangs = []; // languages keyed in the database at the last refresh (refreshStats)
let storedLangs = []; // the languages chosen in storage at the last refresh
let extractOnHand = false; // the kept list exists, so changed ticks need no download
let onHand = () => false; // ...and covers these languages (refreshStats)
// The ticks are a draft until the button under the list is clicked: the
// ticked languages when they differ from storedLangs, else null.
let draftLangs = null;
const sameLangs = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
let omdbConnected = false; // OMDb lookups on with a confirmed key (refreshStats)

// What the status line says while a build runs, in place of the database
// line (refreshStats, and showBuild on every progress tick): its progress,
// so that with the bar in the Update now row a build moves nothing on the
// page. null: the line is the database's (a failure is reported where its
// retry lives, refreshStats; a cancel beside Update now, showBuild). Two
// lines at most at the window's width.
function buildLine(build) {
  if (!build || build.status !== 'running') return null;
  const unit = { basics: ' titles', episodes: ' episodes' }[build.phase];
  const detail = unit && build.detail ? ' (' + build.detail.toLocaleString() + unit + ' so far)' : '';
  // A full build's titles go live before the episodes download.
  const usable = build.usable ? 'Ratings now show (reload open streaming tabs). ' : '';
  // Cancel pressed: a download stops at once, a save (builder.js cancel)
  // runs to its end first.
  const cancelling = !build.cancelling ? '' : build.phase === SAVING_PHASE ? 'Cancelling after this save: ' : 'Cancelling: ';
  return cancelling + usable + (PHASES[build.phase] || build.phase) + ' ' + Math.round((build.pct || 0) * 100) + '%' + detail;
}

// A build cancelled while this page was open says so next to Update now
// (the status line keeps its own text, which says what shows meanwhile);
// a page opened later starts clean. Nothing changed, unless the run had
// already made something live (build.saved, builder.js cancel): a full
// build its titles, which the status line then reports as episodes
// pending, or a ratings pass some of its ratings.
const PAGE_OPENED = Date.now();
const CANCELLED = {
  titles: 'Cancelled after the titles were saved.',
  ratings: 'Cancelled; the ratings updated so far stay.',
};

function showBuild(build) {
  const btn = $('build');
  const running = !!build && build.status === 'running';
  btn.title = omdbOnlyMode ? 'Not used with OMDb only' : '';
  btn.disabled = running || omdbOnlyMode;
  $('buildRatings').disabled = running || !ratingsPassOk;
  $('buildRatings').title = ratingsPassOk ? 'Re-reads IMDb’s ratings file and updates every stored rating' : 'Needs a finished full build first (Update now)';
  $('buildDone').hidden = true;
  $('buildBarRow').hidden = !running;
  const cancelledHere = !!build && build.status === 'cancelled' && (build.at || 0) >= PAGE_OPENED;
  $('buildAfter').hidden = !cancelledHere;
  if (cancelledHere) $('buildAfter').textContent = CANCELLED[build.saved] || 'Cancelled; nothing was changed.';
  if (running) {
    $('cancelBuild').disabled = !!build.cancelling;
    $('buildBar').value = build.pct || 0;
    $('localStatus').textContent = buildLine(build);
    $('localStatus').classList.remove('bad');
    return;
  }
  // A failure is refreshStats' to report, which follows every change of
  // state.
  if (build && build.status === 'done' && Date.now() - (build.at || 0) < DONE_RECENT_MS) {
    $('doneText').textContent = build.kind === 'ratings'
      ? 'Ratings updated' + (build.info.unknown ? '; ' + WAITING(build.info.unknown) + '.' : '.')
      : build.kind === 'akas'
      ? ((build.info.langs || []).length ? 'Titles in ' + languageNames(build.info.langs) + ' matched' : 'Titles in other languages removed') + ' (reload any streaming sites that are already open).'
      : build.info.titles.toLocaleString() + ' titles. Ratings now show on the streaming sites ' +
        '(reload any that are already open).' +
        // The rebuild's last step, a fresh list of titles in other
        // languages, failed: the kept list still serves (builder.js step 6).
        (build.info.akasError ? ' The list of titles in other languages could not be refreshed (' + build.info.akasError + '); the kept one stays in use.' : '');
    $('buildDone').hidden = false;
  }
}

// In its own window (the usual way it opens) or a tab, the panel offers to
// close itself; closing the window's only tab closes the window. Inside
// Chrome's embedded options dialog there is no tab, so the button stays hidden.
chrome.tabs.getCurrent((tab) => {
  if (!tab) return;
  $('closeTab').hidden = false;
  $('closeTab').addEventListener('click', () => chrome.tabs.remove(tab.id));
});

async function refreshStats() {
  let u;
  try {
    u = await chrome.runtime.sendMessage({ type: 'usage' });
  } catch (e) {
    u = null;
  }
  if (!u) {
    say(STALE_WORKER, 'bad');
    return;
  }
  const l = u.local || {};
  builtAt = l.present ? l.builtAt || 0 : 0;
  const building = u.build && u.build.status === 'running';
  const keyed = !!(u.schedule && u.schedule.keyed); // OMDb lookups on, key confirmed
  omdbOnlyMode = !!u.omdbOnly;
  dbPresent = !!l.present;
  ratingsPassOk = !omdbOnlyMode && !!(l.present && !l.outdated && l.episodes);
  // The source choice: both are always offered. OMDb only before the key
  // works gives no ratings, which the status line says (in red), pointing
  // at the key field below.
  omdbConnected = keyed;
  $('sourceLocal').checked = !omdbOnlyMode;
  $('sourceOmdb').checked = omdbOnlyMode;
  $('useOmdbText').textContent = omdbOnlyMode ? '(every rating comes from here)' : '(titles the database lacks, and the scores below)';
  // The status line: a build that runs, failed or was just cancelled
  // (buildLine) comes first. No database yet: with OMDb lookups on and a
  // key that works, every title goes to OMDb meanwhile (background.js
  // lookup); otherwise nothing shows, which the line says in red, as it
  // does for OMDb only without a key. Two lines either way, like the
  // other states.
  const noDb = !omdbOnlyMode && !l.present;
  const line = buildLine(u.build);
  $('localStatus').textContent = line ? line
    : omdbOnlyMode ? omdbOnlyStatus(l, keyed)
    : noDb ? (keyed
      ? 'Not built yet; ratings come from OMDb meanwhile. Click Update now to build it (a few minutes), or choose OMDb only above.'
      : 'No ratings yet: click Update now to build the database (a few minutes), or enter an OMDb key below and choose OMDb only.')
    : localStatus(l, building, !!(u.schedule && u.schedule.manual), await diskUsage());
  $('localStatus').classList.toggle('bad', !line && (omdbOnlyMode || noDb) && !keyed);
  // A failed build is reported where its retry lives, in red: the full
  // and ratings passes in the next-refresh line (their schedule), the
  // languages pass in the languages line (Get titles). The status line
  // keeps the database's own summary.
  const failed = u.build && u.build.status === 'error' && !omdbOnlyMode ? u.build : null;
  const failedBuild = !!(failed && failed.kind !== 'akas');
  const failedAkas = !!(failed && failed.kind === 'akas' && u.langsOn);
  $('nextRefresh').textContent = failedBuild
    ? 'Last build failed: ' + failed.message + '.' + (l.present && u.autoRefresh !== false ? ' Retried automatically in a day.' : '')
    : l.present && !building && !omdbOnlyMode ? nextRefresh(u) : '';
  $('nextRefresh').classList.toggle('bad', failedBuild);
  $('auto').checked = u.autoRefresh !== false;
  $('auto').disabled = omdbOnlyMode;
  $('autoText').textContent = scheduleText(u.schedule);
  $('otherLangs').checked = !!u.langsOn;
  $('otherLangs').disabled = omdbOnlyMode;
  const listWasHidden = $('langBox').hidden;
  $('langBox').hidden = !u.langsOn || omdbOnlyMode;
  renderLanguages(u, building, listWasHidden);
  $('otherLangsText').textContent = omdbOnlyMode ? '' : failedAkas ? 'Get titles failed: ' + failed.message + '. Click Get titles to try again.' : otherLanguagesText(u, l, building);
  loadedLangs = l.akasAt ? l.langs || [] : [];
  storedLangs = u.langs || [];
  extractOnHand = !!l.akasAt;
  // Whether the kept list can key these languages: it must exist and date
  // from after each was added (background.js langsNeed, db.js AKAS_NEEDS),
  // else Get titles reads the file again.
  onHand = (langs) => !!l.akasAt && (langs || []).every((x) => ((u.langsNeed || {})[x] || 1) <= (l.akasFormat || 1));
  if (u.langsOn) $('forgetLine').hidden = true; // the offer belongs to the moment of unticking
  // Languages ticked but the list never fetched: said in red, since the
  // option looks on while nothing matches yet.
  // Red while ticked languages cannot match yet: no database, or no list
  // of titles on hand (Get titles).
  $('otherLangsText').classList.toggle('bad', failedAkas || !!(u.langsOn && !omdbOnlyMode && !onHand(storedLangs) && storedLangs.length && !building && draftLangs === null));
  // The button applies the ticks: Get titles while the list was never
  // fetched (the one place the 520 MB is read), Apply once it is on hand
  // and only the keys change. Shown for a draft, or for languages chosen
  // but never fetched.
  $('downloadLangs').hidden = !(u.langsOn && l.present && !building && !omdbOnlyMode && (draftLangs !== null || (!onHand(storedLangs) && storedLangs.length)));
  const apply = onHand(draftLangs || storedLangs);
  $('downloadLangs').textContent = apply ? 'Apply' : 'Get titles';
  $('downloadLangs').title = apply ? 'From the kept list, no download' : 'Reads 520 MB from IMDb, keeps about 50 MB';
  $('ratingsDays').value = String(u.ratingsDays);
  $('fullDays').value = String(u.fullDays);
  $('ratingsDays').disabled = omdbOnlyMode;
  $('fullDays').disabled = omdbOnlyMode;
  showBuild(u.build);
  // "All set. Titles in Polish matched" is stale once the option was
  // switched off (the kept list is gone) within the box's ten minutes.
  if (u.build && u.build.kind === 'akas' && !l.akasAt) $('buildDone').hidden = true;
  $('stored').textContent = u.stored.toLocaleString();
  $('today').textContent = u.today.toLocaleString();
  $('limit').textContent = u.limitHit ? '(limit reached; paused for now)' : '';
  // The Use OMDb box, the switch for all OMDb traffic. Under OMDb only it
  // is on and stays on: that mode has no other source (the source handler
  // stores it so, loadOmdb catches an older choice, and background.js
  // omdbSettings counts it on regardless). Under Local database it is greyed
  // without a saved key, or while one is being typed (keyDirty), as are
  // the extras below, whatever a build or a lookup changed meanwhile.
  const box = $('useOmdb');
  if (omdbOnlyMode) {
    box.checked = true;
    box.disabled = true;
    box.parentElement.classList.remove('off');
    box.parentElement.title = 'OMDb only needs it; choose Local database to switch OMDb off';
  } else {
    const armed = !!savedKey && !keyDirty();
    box.disabled = !armed;
    box.parentElement.classList.toggle('off', !armed);
    box.parentElement.title = savedKey ? '' : 'Enter a key below and click Test first';
  }
  // The note is short enough to share the last "Also show" row, so it
  // moves nothing when it comes and goes.
  const note = keyDirty() ? '(click Test first)' : !savedKey ? '(no working key)' : !box.checked ? '(tick Use OMDb)' : '(no working key)';
  loadExtras(!keyDirty() && keyed, note);
}

// What the database holds and when it was built: the full build's date,
// and the ratings pass's when it came later. A first run whose episode
// stage was interrupted has titles only until the next full rebuild. One
// built by an older version is rebuilt once by itself, unless the
// automatic refresh is off: then this line asks for it.
// manual: the full rebuild is Update now's alone (Advanced), so what waits
// for one says so.
// What the extension's storage takes on disk, from the browser (the
// database and the remembered ratings together), as "312 MB"; '' when
// the browser won't say. The panel's other MB figures are reads from
// IMDb over the network, which this line keeps apart. The estimate walks
// the storage, so it is kept for a while: refreshStats runs on every
// click, and the figure only moves when a build ends (diskChanged).
const DISK_KEEP_MS = 60 * 1000;
let diskAt = 0;
let diskText = '';

async function diskUsage() {
  if (Date.now() - diskAt < DISK_KEEP_MS) return diskText;
  try {
    const e = await navigator.storage.estimate();
    diskText = e && e.usage ? Math.round(e.usage / 1048576) + ' MB' : '';
  } catch (err) {
    diskText = '';
  }
  diskAt = Date.now();
  return diskText;
}

const diskChanged = () => { diskAt = 0; };

function localStatus(l, building, manual, disk) {
  let s = l.titles.toLocaleString() + ' titles' + (l.episodes ? ' and ' + l.episodes.toLocaleString() + ' episodes' : '') +
    ', built ' + l.built + ' (' + ago(l.builtAt) + ')' + (disk ? ', ' + disk + ' on disk' : '');
  if (l.ratingsAt > l.builtAt) s += '; ratings updated ' + l.ratingsBuilt + ' (' + ago(l.ratingsAt) + ')';
  s += '.';
  if (l.unknown) s += ' ' + WAITING(l.unknown).replace(/^./, (c) => c.toUpperCase()) + (manual ? ' (Update now).' : '.');
  if (!l.episodes) {
    s += building ? ' Episode ratings are still downloading.'
      : manual ? ' Episode ratings arrive when you click Update now.' : ' Episode ratings arrive with the next full rebuild.';
  }
  if (l.outdated) {
    s += manual ? ' Built by an older version; click Update now to rebuild it, which ratings updates need too.'
      : ' Built by an older version; the next automatic refresh rebuilds it (or click Update now).';
  }
  return s;
}

// The language list under "Match titles in other languages": every
// language the database can key (usage langsAll), by English name, the
// chosen ones ticked, with a hint on the browser's own language and on
// languages seen on streaming pages. Built once; later calls only update
// the ticks.
// The ticked languages come first, the rest alphabetically. The order is set
// while the list is out of sight (page load, box unticked), so a language
// ticked just now stays where it was until the list is next shown.
function renderLanguages(u, building, reorder) {
  const box = $('langList');
  if (!box.children.length && (u.langsAll || []).length) {
    const rows = u.langsAll.map((code) => ({ code, name: languageNames([code]) || code }));
    rows.sort((a, b) => a.name.localeCompare(b.name));
    for (const { code, name } of rows) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = code;
      input.addEventListener('change', tickLanguages);
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + name + ' '));
      const hint = document.createElement('span');
      hint.className = 'hint';
      label.appendChild(hint);
      box.appendChild(label);
    }
  }
  const chosen = new Set(draftLangs || u.langs || []);
  const browser = new Set(u.langsBrowser || []);
  const pages = new Set(u.langsPages || []);
  for (const label of box.querySelectorAll('label')) {
    const input = label.querySelector('input');
    input.checked = chosen.has(input.value);
    input.disabled = !!building;
    label.querySelector('.hint').textContent = browser.has(input.value) ? '(your browser)' : pages.has(input.value) ? '(seen on a streaming page)' : '';
  }
  if (reorder) {
    const labels = [...box.querySelectorAll('label')];
    labels.sort((a, b) => (chosen.has(b.querySelector('input').value) - chosen.has(a.querySelector('input').value)) || a.childNodes[1].textContent.localeCompare(b.childNodes[1].textContent));
    for (const label of labels) box.appendChild(label);
  }
}

// A tick is a draft: nothing is written or built until the button under the
// list is clicked, so several languages go in one pass, and unticking
// before the click is the way to change one's mind.
function tickLanguages() {
  const ticked = [...$('langList').querySelectorAll('input:checked')].map((i) => i.value);
  if (!dbPresent) {
    // No database, so no Apply: the first build (Update now) reads the
    // choice from storage, and nothing can start before it.
    draftLangs = null;
    chrome.storage.sync.set({ titleLangs: ticked }).then(refreshStats);
    if (ticked.length) say('Titles in ' + languageNames(ticked) + ' match once Update now has built the database (reads 520 MB more).', 'bad');
    else say('No language ticked.');
    return;
  }
  draftLangs = sameLangs(ticked, storedLangs) ? null : ticked;
  refreshStats();
}

// Over the picker, one short line: where things stand. The explanation
// of the option itself is in its "i" tip; the option off shows nothing.
function otherLanguagesText(u, l, building) {
  const chosen = u.langs || [];
  const have = l.langs || [];
  if (!u.langsOn) return '';
  if (draftLangs !== null && l.present && !building) {
    return 'Not applied yet: click ' + (onHand(draftLangs) ? 'Apply' : 'Get titles') + ' to ' + (draftLangs.length ? 'match titles in ' + languageNames(draftLangs) : 'match no other language') + '. Nothing changes until then.';
  }
  // No database yet: the ticked languages do nothing until Update now has
  // built it (in red, like the Get titles case below).
  if (!l.present) return chosen.length ? 'Not in use yet: titles in ' + languageNames(chosen) + ' only match once Update now has built the database (reads 520 MB more).' : 'Tick the languages you use; the first build will include them.';
  if (!onHand(chosen)) return chosen.length ? 'Not in use yet: titles in ' + languageNames(chosen) + ' only match after Get titles has run (reads 520 MB, keeps about 50 MB).' : 'Tick the languages you use.';
  const kept = ' List from ' + new Date(l.akasAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' kept (' + Math.round(l.akasSize / 1048576) + ' MB).';
  if (building) return 'Changes apply after the current build.' + kept;
  if (chosen.length !== have.length || chosen.some((x) => !have.includes(x))) return 'Updating…' + kept;
  return (have.length ? 'Matched in ' + languageNames(have) + '.' : 'None ticked.') + kept;
}

// The status line with OMDb only chosen. keyed: OMDb can answer (lookups
// on, key confirmed); otherwise nothing can, and the line says what to fix.
// A database on the device is kept for switching back, and said so.
// Two lines at the window's width, like localStatus (and the line is held
// at two, options.html), so switching the source moves nothing below it.
// OMDb's daily limit and Delete database are explained where they live,
// the tooltip above and Advanced.
function omdbOnlyStatus(l, keyed) {
  const titles = l.present ? l.titles.toLocaleString() + ' titles' : '';
  if (!keyed) {
    return 'No ratings yet: enter an OMDb key below and click Test, or choose Local database' +
      (l.present ? ' (' + titles + ' kept).' : ' and click Update now.');
  }
  return 'Not used: ratings come from OMDb' +
    (l.present ? '. The database (' + titles + ', built ' + l.built + ') is kept for switching back.' : ' (1,000 lookups a day, each remembered for 30 days).');
}

// The next automatic refresh (background.js refreshPlan): which kind, what
// it downloads and when, and how new titles arrive for people without an
// OMDb key. The paragraph holds two lines (options.html), and the ratings
// text leaves the sizes and intervals to the box's own label above it so
// that it fits them whatever the weekday.
function nextRefresh(u) {
  const n = u.next || {};
  if (u.autoRefresh === false) {
    const mb = n.fullMb || 280;
    return 'Automatic refresh is off. Update now rebuilds everything (reads ' + mb + ' MB from IMDb' + (n.akas ? ', with a fresh list of titles in other languages' : '') + ').';
  }
  if (!n.kind) return '';
  if (n.kind === 'ratings') {
    return 'Next: ratings only, ' + due(n.due) + '. New titles arrive with the full rebuild; ' +
      (n.keyed ? 'OMDb covers them meanwhile.' : 'an OMDb key would cover them sooner.');
  }
  // The language ticks changed: keyed again from the kept list (local,
  // seconds), or waiting for the Download button when there is none.
  if (n.kind === 'akas') {
    if (n.mb) return 'Waiting for the Get titles button: titles in ' + languageNames(n.langs) + ' (reads ' + n.mb + ' MB, keeps about 50 MB).';
    return 'Next: titles in ' + (n.langs.length ? languageNames(n.langs) : 'no other language') + ', from the kept list, ' + due(n.due) + '.';
  }
  const why = {
    unknown: 'many newly rated titles are waiting',
    episodes: 'the episode list never finished',
    format: 'it was built by an older version',
  }[n.reason];
  // The MB figure counts the languages list; the words for it fit the two
  // lines only without a reason, which matters more (the figure stays).
  const withAkas = n.akas && !why ? ', with a fresh list of titles in other languages' : '';
  if (n.manual) return 'Waiting for Update now: full rebuild (reads ' + n.mb + ' MB' + withAkas + ')' + (why ? ', because ' + why : '') + '.';
  return 'Next: full rebuild (reads ' + n.mb + ' MB' + withAkas + '), ' + due(n.due) + (why ? ', because ' + why : '') + '.';
}

// Update now rebuilds regardless of age, but a database under a day old is
// almost certainly current, so ask for a second click before re-downloading
// 280 MB.
let builtAt = 0;
let confirmUntil = 0;

function sinceBuild() {
  const mins = Math.round((Date.now() - builtAt) / 60000);
  if (mins < 60) return mins + ' minute' + (mins === 1 ? '' : 's') + ' ago';
  const hours = Math.round(mins / 60);
  return hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
}

function showNote(text) {
  const n = $('buildNote');
  n.textContent = text;
  n.hidden = !text;
}

$('build').addEventListener('click', async () => {
  const fresh = builtAt && Date.now() - builtAt < 24 * 60 * 60 * 1000;
  if (fresh && Date.now() > confirmUntil) {
    confirmUntil = Date.now() + 8000;
    showNote('Built ' + sinceBuild() + ', so it is current and there’s nothing to do; you can close this page. Click again to rebuild anyway.');
    setTimeout(() => { if (Date.now() >= confirmUntil) showNote(''); }, 8200);
    return;
  }
  confirmUntil = 0;
  showNote('');
  $('build').disabled = true;
  showBuild(await chrome.runtime.sendMessage({ type: 'build' }));
});

// Stops the build that is running (background.js cancelBuild): a download
// at once, with nothing changed; a save once it is through. For a click
// that was a mistake, and for testing.
$('cancelBuild').addEventListener('click', async () => {
  $('cancelBuild').disabled = true;
  showBuild(await chrome.runtime.sendMessage({ type: 'cancel-build' }));
});

// The ratings-only pass by hand (Advanced): what the weekly refresh does,
// so the progress and the "Ratings updated" box are the same.
$('buildRatings').addEventListener('click', async () => {
  showNote('');
  $('buildRatings').disabled = true;
  showBuild(await chrome.runtime.sendMessage({ type: 'build', kind: 'ratings' }));
});

// Off: the worker drops the keys at once (storage.onChanged); the kept list
// and the ticks stay. On: nothing is keyed yet. The languages stored from
// last time (or, with none, the ones seen) come back as a draft, so the
// same "Not applied yet" line and button appear as for a tick, and the
// stored choice is emptied until Apply writes it again.
$('otherLangs').addEventListener('change', async () => {
  const on = $('otherLangs').checked;
  const loaded = loadedLangs; // before the write: the worker clears them on it
  draftLangs = null;
  const writes = { otherLanguages: on };
  if (on) {
    const { titleLangs } = await chrome.storage.sync.get('titleLangs');
    const stored = Array.isArray(titleLangs) ? titleLangs : [];
    const seen = [...$('langList').querySelectorAll('label')].filter((lb) => lb.querySelector('.hint').textContent).map((lb) => lb.querySelector('input').value);
    const draft = stored.length ? stored : seen;
    draftLangs = draft.length && dbPresent ? draft : null; // no database: stored outright, the first build reads it
    storedLangs = dbPresent ? [] : draft;
    writes.titleLangs = dbPresent ? [] : draft;
  }
  await chrome.storage.sync.set(writes); // one write, one change event in the worker
  say(!on ? 'Titles in other languages off; the kept list stays for turning it back on.'
    : dbPresent ? 'Tick the languages to match, then click the button next to the box.'
    : 'Tick the languages to match; Update now then builds the database with them.');
  // Off with languages loaded: the ratings already matched in them stay
  // remembered (30 days, like any other), which looks as if the option
  // were still on. One line offers to forget them; leaving it is the default.
  $('forgetLine').hidden = on || !loaded.length;
  if (!on && loaded.length) $('forgetText').textContent = 'Ratings already matched in ' + languageNames(loaded) + ' stay remembered for up to 30 days.';
  setTimeout(refreshStats, 500);
});

// Drops the remembered answers that came through the languages store
// (db.js lookup marks them aka); English matches stay.
$('forgetAka').addEventListener('click', async (e) => {
  e.preventDefault();
  $('forgetLine').hidden = true;
  const keys = Object.entries(await ratingEntries()).filter(([, v]) => v && v.aka).map(([k]) => k);
  await chrome.storage.local.remove(keys);
  say('Forgot ' + keys.length + ' ratings matched in other languages; reload any streaming sites that are open.');
  refreshStats();
});

// Applies the draft. With the kept list on hand the worker keys the new
// choice by itself on the write (background.js applyLanguageChoice);
// without it, the build message fetches the 520 MB.
$('downloadLangs').addEventListener('click', async () => {
  $('downloadLangs').disabled = true;
  if (draftLangs !== null) {
    await chrome.storage.sync.set({ titleLangs: draftLangs });
    draftLangs = null;
  }
  if (!extractOnHand) showBuild(await chrome.runtime.sendMessage({ type: 'build', kind: 'akas' }));
  $('downloadLangs').disabled = false;
  setTimeout(refreshStats, 500);
});

$('auto').addEventListener('change', async () => {
  await chrome.storage.sync.set({ autoRefresh: $('auto').checked });
  say($('auto').checked ? 'Automatic refresh on; the intervals are under Advanced.' : 'Automatic refresh off; use Update now when you want.');
  refreshStats();
});

// The intervals (Advanced). A choice applies at the next six-hourly check;
// the "Next:" line shows what it made due.
for (const id of ['ratingsDays', 'fullDays']) {
  $(id).addEventListener('change', async () => {
    await chrome.storage.sync.set({ [id]: Number($(id).value) });
    say('Refresh schedule saved.');
    refreshStats();
  });
}

// Live progress while a build runs: the worker writes its state to session
// storage, which fires this for every update.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.buildState) {
    const s = changes.buildState.newValue;
    showBuild(s);
    // The line at the top right reports the last click ("Click Update now
    // to build…", "Tick the languages…"); a finished build makes any of
    // that stale, and the green box says what to do now.
    if (s && s.status === 'done') say('');
    if (s && ['done', 'cancelled', 'error'].includes(s.status)) {
      diskChanged();
      refreshStats();
    }
  }
});

// --------------------------------------------------------------- sites

// Which services the content script runs on. Stored as one object keyed by
// the adapter's name; a missing key means on, so new sites default to on.
// Opt-in sites (data-origins, see OPTIONAL_SITES in background.js) are on
// only while Chrome also grants their host: ticking one asks for it,
// unticking gives it back.
const SITE_BOXES = [...document.querySelectorAll('input.site')];
const originsOf = (box) => (box.dataset.origins ? box.dataset.origins.split(' ') : null);

// Firefox lets the user withdraw a site's access on about:addons even for
// sites the manifest asks for, so there every site works like an opt-in
// one: unticked while access is withdrawn, and ticking it asks Firefox for
// access again. Unticking keeps the access (data-keep); the extension just
// stays idle there, as in Chrome. The patterns asked for are the content
// script's own: Firefox accepts exactly what the manifest declares and
// rejects anything broader (www.amazon.com/* for www.amazon.com/gp/video/*).
if (FIREFOX) {
  for (const cs of chrome.runtime.getManifest().content_scripts || []) {
    // Firefox reports full URLs (moz-extension://…/sites/netflix.js).
    const name = ((cs.js || [])[0] || '').match(/(?:^|\/)sites\/(\w+)\.js$/);
    const box = name && SITE_BOXES.find((b) => b.dataset.site === name[1]);
    if (!box || box.dataset.origins) continue;
    box.dataset.origins = cs.matches.join(' ');
    box.dataset.keep = '1';
  }
}

// Each box remembers whether the browser grants its site (data-granted), so
// ticking a site that already has access neither asks again nor tells the
// user to reload its tabs: the content script picks the setting up live.
async function loadSites() {
  const { sites = {} } = await chrome.storage.sync.get('sites');
  for (const box of SITE_BOXES) {
    const origins = originsOf(box);
    const granted = !origins || (await chrome.permissions.contains({ origins }));
    box.dataset.granted = granted ? '1' : '';
    box.checked = granted && sites[box.dataset.site] !== false;
  }
}

for (const box of SITE_BOXES) {
  box.addEventListener('change', async () => {
    const label = box.parentElement.textContent.trim().split(' (')[0];
    const origins = originsOf(box);
    let note = '';
    if (origins && box.checked && !box.dataset.granted) {
      // Must be the first await: the browser only asks during the click.
      const granted = await chrome.permissions.request({ origins }).catch(() => false);
      if (!granted) {
        box.checked = false;
        say(label + ' stays off: access to the site was not allowed.', 'bad');
        return;
      }
      box.dataset.granted = '1';
      note = ' Reload any ' + label + ' tab that was already open.';
    }
    const sites = {};
    for (const b of SITE_BOXES) sites[b.dataset.site] = b.checked;
    await chrome.storage.sync.set({ sites });
    if (origins && !box.checked && !box.dataset.keep) {
      await chrome.permissions.remove({ origins }).catch(() => {});
      box.dataset.granted = '';
    }
    if (origins && !box.dataset.keep) await chrome.runtime.sendMessage({ type: 'sync-sites' }).catch(() => {});
    say(label + (box.checked ? ' on.' : ' off.') + note);
  });
}

// -------------------------------------------------------------- badges

// How card badges show: cardBadges 'always' | 'hover' | 'off', and hideNA
// to drop the grey "n/a" ones. Previews, banners and title pages always
// show the rating. Read by the content script, which applies changes live.
const MODE_BOXES = [...document.querySelectorAll('input[name=cardBadges]')];
const MODE_SAID = {
  always: 'Card badges always show.',
  hover: 'Card badges show when the mouse is over a card.',
  off: 'Card badges off; previews, banners and title pages still show ratings.',
};

// badgeLabel: 'star' (default) or 'imdb', the tag shown before the score.
const LABEL_BOXES = [...document.querySelectorAll('input[name=badgeLabel]')];

async function loadBadges() {
  const { cardBadges = 'always', hideNA = true, badgeLabel = 'star' } =
    await chrome.storage.sync.get(['cardBadges', 'hideNA', 'badgeLabel']);
  for (const box of MODE_BOXES) box.checked = box.value === cardBadges;
  $('hideNA').checked = hideNA;
  for (const box of LABEL_BOXES) box.checked = box.value === badgeLabel;
}

for (const box of LABEL_BOXES) {
  box.addEventListener('change', async () => {
    if (!box.checked) return;
    await chrome.storage.sync.set({ badgeLabel: box.value });
    say(box.value === 'imdb' ? 'Badges show the IMDb tag.' : 'Badges show a star.');
  });
}

for (const box of MODE_BOXES) {
  box.addEventListener('change', async () => {
    if (!box.checked) return;
    await chrome.storage.sync.set({ cardBadges: box.value });
    say(MODE_SAID[box.value]);
  });
}

$('hideNA').addEventListener('change', async () => {
  await chrome.storage.sync.set({ hideNA: $('hideNA').checked });
  say($('hideNA').checked ? '“n/a” badges hidden on cards.' : '“n/a” badges shown on cards.');
});

// ---------------------------------------------------------------- OMDb

// The checkbox means "OMDb is in use": fallback enabled and a key saved.
// The key field is always there, since entering a key is how OMDb starts.
// Test is what saves it (and checks it); while the field holds something
// other than the saved key, the checkbox, the OMDb-only choice and the
// extras are greyed with a note, so a pasted key is never mistaken for a
// saved one. Unticking the checkbox keeps the key so it can be turned
// back on without re-entering it.
let savedKey = '';
let keyEdited = false; // the field was typed in since the last load or Test

async function loadOmdb() {
  const { omdbKey = '', omdbFallback = true, ratingsSource } = await chrome.storage.sync.get(['omdbKey', 'omdbFallback', 'ratingsSource']);
  // OMDb only has no other source, so Use OMDb is on under it. The source
  // handler stores that on the switch; a choice stored before 1.2.0, when
  // the box could stay off, is put right here, once per load.
  const useOmdb = omdbFallback || ratingsSource === 'omdb';
  if (useOmdb && !omdbFallback) await chrome.storage.sync.set({ omdbFallback: true });
  savedKey = omdbKey;
  keyEdited = false;
  $('key').value = omdbKey;
  const on = !!omdbKey && useOmdb && (await omdbConsent());
  $('useOmdb').checked = on;
  $('useOmdb').disabled = !omdbKey;
  $('useOmdb').parentElement.classList.toggle('off', !omdbKey);
  $('useOmdb').parentElement.title = omdbKey ? '' : 'Enter a key below and click Test first';
  $('testResult').textContent = '';
  $('testResult').title = '';
}

// A key being typed: nothing below it applies until Test saves it. Any
// edit counts, even one that ends with the saved key typed back in; only
// Test (through loadOmdb) arms the fields again.
function keyDirty() {
  return keyEdited;
}

$('key').addEventListener('input', () => {
  keyEdited = true;
  $('useOmdb').disabled = true;
  $('useOmdb').parentElement.classList.add('off');
  loadExtras(false, '(click Test first)');
});
$('key').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('test').click();
});

// Firefox: OMDb lookups send title names off the device, which Firefox has
// the user approve. askOmdbConsent (compat.js) asks whenever OMDb is
// switched on, saved or tested, as the click handler's first await.
const NO_CONSENT = 'OMDb stays off: Firefox was not allowed to let the extension send title names to OMDb.';

$('useOmdb').addEventListener('change', async () => {
  const on = $('useOmdb').checked;
  if (on && !(await askOmdbConsent())) {
    $('useOmdb').checked = false;
    say(NO_CONSENT, 'bad');
    return;
  }
  await chrome.storage.sync.set({ omdbFallback: on });
  say(on ? 'OMDb lookups on.' : 'OMDb lookups off.');
  refreshStats();
});

// Test saves whatever is in the field (an empty field clears the key)
// and then asks the worker to try it, so a pass means the saved key works.
$('test').addEventListener('click', async () => {
  const out = $('testResult');
  const omdbKey = $('key').value.trim();
  if (omdbKey && !(await askOmdbConsent())) {
    out.className = 'bad';
    out.textContent = 'OMDb stays off: Firefox did not allow sending titles.';
    out.title = NO_CONSENT;
    return;
  }
  await chrome.storage.sync.set({ omdbKey, omdbFallback: !!omdbKey });
  // A new key means an earlier "limit reached" pause no longer applies.
  await chrome.storage.local.remove(['limitHitDay', 'limitPauseUntil']);
  if (!omdbKey) {
    say('Key cleared; OMDb lookups off.');
    await loadOmdb();
    refreshStats();
    return;
  }
  out.className = '';
  out.textContent = 'Testing…';
  out.title = '';
  let r;
  try {
    r = await chrome.runtime.sendMessage({ type: 'test' });
  } catch (e) {
    r = null;
  }
  if (!r) {
    out.className = 'bad';
    out.textContent = 'Worker out of date: reload the extension, then reopen.';
    out.title = STALE_WORKER;
    return;
  }
  // One line, so nothing below moves; the fuller account is its tooltip.
  const text = (r.ok ? 'Key works: ' : 'Key failed: ') + r.detail;
  await loadOmdb();
  out.className = r.ok ? 'ok' : 'bad';
  out.textContent = text;
  out.title = r.more ? text + '\n' + r.more : text;
  say(r.ok ? 'Key saved and working; OMDb lookups on.' : 'Key saved, but it did not work; see below.', r.ok ? 'ok' : 'bad');
  refreshStats();
});

// Extra scores from OMDb (sync extraRatings {rt, mc, awards, imdb, cards};
// the scores, awards and cards on and the IMDb figure off until the user
// changes a box, the same default as content.js and background.js). The
// boxes are greyed out, with a note, until the saved key is confirmed
// working (a passed Test, or any OMDb answer); ticks are kept while greyed,
// so they apply again once the key works.
const EXTRA_BOXES = [...document.querySelectorAll('input.extra')];
const EXTRAS_DEFAULT = { rt: true, mc: true, awards: true, cards: true };

async function loadExtras(keyOk, note = '(no working key)') {
  const { extraRatings = EXTRAS_DEFAULT } = await chrome.storage.sync.get('extraRatings');
  for (const box of EXTRA_BOXES) {
    box.checked = !!extraRatings[box.dataset.extra];
    box.disabled = !keyOk;
  }
  $('extras').classList.toggle('off', !keyOk);
  $('extrasNote').hidden = !!keyOk;
  $('extrasNote').textContent = note;
}

async function saveExtras() {
  const extraRatings = {};
  for (const b of EXTRA_BOXES) extraRatings[b.dataset.extra] = b.checked;
  await chrome.storage.sync.set({ extraRatings });
}

for (const box of EXTRA_BOXES) {
  box.addEventListener('change', async () => {
    await saveExtras();
    say(box.parentElement.textContent.trim() + (box.checked ? ' on.' : ' off.'));
  });
}

// ------------------------------------------------------------ advanced

async function ratingEntries() {
  const all = await chrome.storage.local.get(null);
  const out = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith('r:')) out[k] = v;
  return out;
}

$('clear').addEventListener('click', async () => {
  const keys = Object.keys(await ratingEntries());
  await chrome.storage.local.remove(keys);
  say('Cleared ' + keys.length + ' remembered ratings.');
  refreshStats();
});

// Deletes the database (background.js deleteDatabase) and reports in the
// status line; true when it went. Shared by Delete database and the
// switch to OMDb only.
async function deleteDatabase() {
  // Emptying ~420,000 titles takes a few seconds; keep Update now from
  // acting on the old build time meanwhile (it would say "current").
  $('build').disabled = true;
  $('deleteDb').disabled = true;
  say('Deleting the database…');
  let r;
  try {
    r = await chrome.runtime.sendMessage({ type: 'delete-db' });
  } catch (e) {
    r = { ok: false, message: String(e) };
  }
  $('deleteDb').disabled = false;
  $('build').disabled = false;
  if (r && r.ok) {
    builtAt = 0;
    confirmUntil = 0;
    showNote('');
    say('Database deleted' + (r.forgotten ? ' with ' + r.forgotten.toLocaleString() + ' remembered ratings' : '') + '; reload open streaming tabs.');
    return true;
  }
  say('Could not delete the database: ' + ((r && r.message) || 'no answer from the extension') + '.', 'bad');
  return false;
}

$('deleteDb').addEventListener('click', async () => {
  if (!confirm('Delete the local ratings database and forget every remembered rating? Ratings then come from OMDb only (if set up) until you click Update now, which reads about 280 MB from IMDb again.')) return;
  await deleteDatabase();
  refreshStats();
});

// Where ratings come from (sync ratingsSource, background.js omdbOnly).
// OMDb only switches OMDb on (the Use OMDb box, which stays on under it:
// refreshStats), after Firefox's consent prompt; a refusal leaves Local
// database chosen. It can be chosen before there is a working key: the
// cursor then goes to the key field, and the status line says nothing
// shows until Test passes. A database that exists is kept, unused, so
// switching back costs no download; Delete database under Advanced frees
// its space. Without one, switching back shows Update now, and nothing
// downloads until it is clicked.
for (const box of [$('sourceLocal'), $('sourceOmdb')]) {
  box.addEventListener('change', async () => {
    if (!box.checked) return;
    if (box.value === 'omdb') {
      if (!(await askOmdbConsent())) {
        $('sourceLocal').checked = true;
        say(NO_CONSENT, 'bad');
        return;
      }
      await chrome.storage.sync.set({ ratingsSource: 'omdb', omdbFallback: true });
      if (omdbConnected && !keyDirty()) say('OMDb only; reload open streaming tabs.');
      else {
        say('OMDb only: enter a key below and click Test.', 'bad');
        $('key').focus();
        $('key').select();
      }
    } else {
      await chrome.storage.sync.set({ ratingsSource: 'local' });
      say(dbPresent ? 'Local database in use; reload open streaming tabs.' : 'Click Update now to build the local database (reads about 280 MB from IMDb).');
    }
    refreshStats();
  });
}

// Every setting back to its default: all sites on, badges always with the
// star label, no extras, OMDb lookups on if there is a key, the local
// database with the default refresh. The key and the database stay.
const SETTING_KEYS = ['autoRefresh', 'ratingsDays', 'fullDays', 'ratingsSource', 'otherLanguages', 'titleLangs', 'sites', 'cardBadges', 'hideNA', 'badgeLabel', 'omdbFallback', 'extraRatings'];

$('resetSettings').addEventListener('click', async () => {
  if (!confirm('Reset every setting to its default? The OMDb key and the ratings database are kept.')) return;
  const { omdbKey = '' } = await chrome.storage.sync.get('omdbKey');
  await chrome.storage.sync.remove(SETTING_KEYS);
  // The languages seen on streaming pages (background.js notePageLang)
  // pre-tick the language list; after a reset nothing should come pre-ticked.
  await chrome.storage.local.remove('pageLangs');
  if (omdbKey) await chrome.storage.sync.set({ omdbFallback: true });
  await loadSites();
  await loadBadges();
  await loadOmdb();
  await refreshStats();
  say('Settings reset to their defaults' + (omdbKey ? '; the OMDb key is kept.' : '.'));
});

// ------------------------------------------------------------------ go

// After an update (background.js onInstalled), a line at the top right the
// first time the page opens, for versions with something the user may have
// wondered about; shown once, then forgotten.
const UPDATE_NOTES = {
  '1.2.0': FIREFOX
    ? 'Updated to 1.2.0. HBO Max moved to www.hbomax.com; if HBO Max is unticked under Sites, tick it to allow the new address.'
    : 'Updated to 1.2.0. HBO Max moved to www.hbomax.com, which is why Chrome asked about that site.',
};

async function showUpdateNote() {
  const { updateNote } = await chrome.storage.local.get('updateNote');
  if (!updateNote) return;
  const text = UPDATE_NOTES[updateNote.to];
  if (!text || updateNote.from === updateNote.to) {
    await chrome.storage.local.remove('updateNote');
    return;
  }
  // An error on the line (a site not allowed, a stale worker) matters
  // more; the note waits for the next open rather than cover it.
  if ($('status').className === 'bad') return;
  say(text);
  await chrome.storage.local.remove('updateNote');
}

$('version').textContent = 'Version ' + chrome.runtime.getManifest().version;
// The box's state from storage first, then refreshStats' lock under OMDb
// only; the update note last, once every loader has had its say.
Promise.all([loadSites(), loadBadges(), loadOmdb().then(refreshStats)]).then(showUpdateNote);
