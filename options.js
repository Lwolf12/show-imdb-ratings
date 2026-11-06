// The settings page: the database's build and status (refreshStats, which
// also fills the languages section in options-languages.js), the sites
// list (sites-list.js has the table),
// the badges, OMDb, Advanced and the one-time update note. The texts are
// in options-text.js; options.html loads compat.js, options-text.js,
// options-languages.js and this file, in that order (sites-list.js before them), into one global
// scope.

// ------------------------------------------------------------ database

// The green "All set" box is for a build that just finished; the session
// keeps the done state until the browser restarts, and an hours-old one is
// already covered by the "built today" line above.
const DONE_RECENT_MS = 10 * 60 * 1000;

// The ratings-only pass (Advanced) needs a finished full build of the
// current format to update; refreshStats says whether there is one.
let ratingsPassOk = false;
// "OMDb only" chosen (refresh.js omdbOnly): the build and refresh
// controls are greyed, since no database is built or consulted.
let omdbOnlyMode = false;
let dbPresent = false;

let omdbConnected = false; // OMDb lookups on with a confirmed key (refreshStats)

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

const PAGE_TITLE = 'IMDb Ratings settings';

function showBuild(build) {
  const btn = $('build');
  const running = !!build && build.status === 'running';
  // The tab's title carries the percentage, so the progress shows in the
  // tab strip and the window title while the user is elsewhere.
  document.title = running ? Math.round((build.pct || 0) * 100) + '% · ' + PAGE_TITLE : PAGE_TITLE;
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
      ? ((build.info.langs || []).length > 3 ? 'Titles in ' + build.info.langs.length + ' languages matched' // named, they would not fit the box's lines
        : (build.info.langs || []).length ? 'Titles in ' + languageNames(build.info.langs) + ' matched' : 'Titles in other languages removed') + ' (reload any streaming sites that are already open).'
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
  // key that works, every title goes to OMDb meanwhile (lookup.js
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
  $('nextRefresh').textContent = failedBuild
    ? 'Last build failed: ' + failed.message + '.' + (l.present && u.autoRefresh !== false ? ' Retried automatically in a day.' : '')
    : l.present && !building && !omdbOnlyMode ? nextRefresh(u) : '';
  $('nextRefresh').classList.toggle('bad', failedBuild);
  $('auto').checked = u.autoRefresh !== false;
  $('auto').disabled = omdbOnlyMode;
  $('autoText').textContent = scheduleText(u.schedule);
  refreshLanguages(u, l, building, failed); // the languages section, options-languages.js
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
  // stores it so, loadOmdb catches an older choice, and omdb.js
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

// Firefox: the build reads from datasets.imdbws.com, which the user can
// deny there (askImdbAccess, compat.js). Asked first on every build
// button, since Firefox only asks during the click.
const NO_IMDB_ACCESS = 'Nothing built: Firefox was not allowed to let the extension read IMDb’s files from datasets.imdbws.com.';

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
  if (!(await askImdbAccess())) return say(NO_IMDB_ACCESS, 'bad');
  $('build').disabled = true;
  showBuild(await chrome.runtime.sendMessage({ type: 'build' }));
});

// Stops the build that is running (build.js cancelBuild): a download
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
  if (!(await askImdbAccess())) return say(NO_IMDB_ACCESS, 'bad');
  $('buildRatings').disabled = true;
  showBuild(await chrome.runtime.sendMessage({ type: 'build', kind: 'ratings' }));
});

$('auto').addEventListener('change', async () => {
  await chrome.storage.sync.set({ autoRefresh: $('auto').checked });
  say($('auto').checked ? 'Automatic refresh on; the intervals are under Advanced.' : 'Automatic refresh off; click Update now to rebuild the database.');
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

// Which sites the content script runs on, and where (sites-list.js). The
// list shows every site the extension knows and every address the user
// added under one, ticked rows first, in an order set when the page opens
// and held while it is open; the add row under the list takes an address
// and the site whose pages it serves.
//
// Stored as one object ("sites") keyed by the adapter's name, a missing
// key meaning on, plus one key per added address (its own switch, which
// content.js consults on its pages); the added addresses themselves are
// in "addresses" (name -> [address]).
//
// The eight required sites toggle on and off. An optional site, and
// every added address, also needs the browser's permission for its
// address: ticking asks for it, inside the click, the only time the
// browser allows the question; unticking an optional site gives the
// permission back, unticking an address keeps it, so ticking again is
// instant. Firefox treats the required sites the same way: it lets the
// user withdraw a site's access on about:addons, so a required site there
// shows unticked while access is withdrawn, ticking asks again (for the
// content script's own patterns: Firefox accepts exactly what the manifest
// declares) and unticking keeps the access, the extension just staying
// idle there.
const SL = IMDBEXT_SITES;
const siteRows = []; // [{key, name, address|null, box, label, hint, granted}] in list order
let knownAddresses = {}; // the "addresses" object as last loaded (the add row checks against it before asking the browser)

const patternsOf = (row) => (row.address ? [SL.patternOf(row.address)] : SL.SITES[row.name].addresses.map(SL.patternOf));
// Whether the browser must grant a row's address(es) before it can be on.
const needsGrant = (row) => !!row.address || !!SL.SITES[row.name].optional || FIREFOX;
// Whether unticking keeps the grant.
const keepGrant = (row) => !!row.address || (FIREFOX && !SL.SITES[row.name].optional);
// Whether the background registers the row's content script (not the
// manifest's own sites).
const registered = (row) => !!row.address || !!SL.SITES[row.name].optional;

function siteHint(row) {
  if (row.address) return '(' + SL.SITES[row.name].label + (row.granted ? '' : ', not allowed here') + ')';
  return SL.SITES[row.name].note ? '(' + SL.SITES[row.name].note + ')' : '';
}

function siteRow(name, address) {
  const label = document.createElement('label');
  label.className = address ? 'check address' : 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'site';
  box.dataset.key = address || name;
  label.appendChild(box);
  label.appendChild(document.createTextNode(' ' + (address || SL.SITES[name].label) + ' '));
  const hint = document.createElement('span');
  hint.className = 'hint';
  label.appendChild(hint);
  const row = { key: address || name, name, address: address || null, box, label, hint, granted: false };
  if (address) {
    const x = document.createElement('a');
    x.className = 'x';
    x.href = '#';
    x.title = 'Remove this address';
    x.textContent = '×';
    x.addEventListener('click', (e) => {
      e.preventDefault();
      removeAddress(row);
    });
    label.appendChild(x);
  }
  box.addEventListener('change', () => siteChanged(row));
  return row;
}

// Builds the list: the sites in the table's order, then the added
// addresses, ticked rows first. A row's tick is its switch, and only
// while the browser grants its address.
async function loadSites() {
  const { sites = {}, addresses = {} } = await chrome.storage.sync.get(['sites', 'addresses']);
  knownAddresses = addresses;
  const rows = SL.NAMES.map((name) => siteRow(name, null));
  for (const name of SL.NAMES) for (const a of SL.addedTo(name, addresses)) rows.push(siteRow(name, a));
  for (const row of rows) {
    row.granted = !needsGrant(row) || (await chrome.permissions.contains({ origins: patternsOf(row) }));
    row.box.checked = row.granted && sites[row.key] !== false;
    row.hint.textContent = siteHint(row);
  }
  rows.sort((a, b) => b.box.checked - a.box.checked); // stable: the table's order within each group
  const list = $('siteList');
  list.replaceChildren();
  siteRows.length = 0;
  for (const row of rows) {
    list.appendChild(row.label);
    siteRows.push(row);
  }
}

// Access granted or withdrawn elsewhere (Site access on chrome://extensions,
// about:addons): the ticks follow, in place. The browser fires the same
// event for the page's own request, before the tick that asked has been
// saved; a row whose change is still in hand is left alone, or the old
// stored value would untick it.
async function refreshGrants() {
  const { sites = {} } = await chrome.storage.sync.get('sites');
  for (const row of siteRows) {
    if (!needsGrant(row) || row.busy) continue;
    row.granted = await chrome.permissions.contains({ origins: patternsOf(row) });
    row.box.checked = row.granted && sites[row.key] !== false;
    row.hint.textContent = siteHint(row);
  }
}
if (chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(() => refreshGrants());
  chrome.permissions.onRemoved.addListener(() => refreshGrants());
}

async function saveSites() {
  const sites = {};
  for (const row of siteRows) sites[row.key] = row.box.checked;
  await chrome.storage.sync.set({ sites });
}

async function siteChanged(row) {
  const { box } = row;
  const label = row.address || SL.SITES[row.name].label;
  let note = '';
  row.busy = true;
  try {
    if (box.checked && needsGrant(row) && !row.granted) {
      // Must be the first await: the browser only asks during the click.
      const granted = await chrome.permissions.request({ origins: patternsOf(row) }).catch(() => false);
      if (!granted) {
        box.checked = false;
        say(label + ' stays off: access to the site was not allowed.', 'bad');
        return;
      }
      row.granted = true;
      row.hint.textContent = siteHint(row);
      note = ' Reload any ' + label + ' tab that was already open.';
    }
    await saveSites();
    if (!box.checked && needsGrant(row) && !keepGrant(row)) {
      await chrome.permissions.remove({ origins: patternsOf(row) }).catch(() => {});
      row.granted = false;
    }
  } finally {
    row.busy = false;
  }
  if (registered(row)) await chrome.runtime.sendMessage({ type: 'sync-sites' }).catch(() => {});
  say(label + (box.checked ? ' on.' : ' off.') + note);
}

// The add row: an address and the site whose pages it serves. The browser
// is asked for the address itself (the catch-all optional permission lets
// it be asked for any https address), inside the click, so the checks
// before it use nothing but what the page already holds.
for (const name of SL.NAMES) {
  const o = document.createElement('option');
  o.value = name;
  o.textContent = SL.SITES[name].label;
  $('siteAdapter').appendChild(o);
}
$('siteAddress').addEventListener('input', () => {
  const guess = SL.guessSite(SL.normalizeAddress($('siteAddress').value) || '');
  if (guess) $('siteAdapter').value = guess;
});
$('siteAddress').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('siteAddBtn').click();
});

$('siteAddBtn').addEventListener('click', async () => {
  const address = SL.normalizeAddress($('siteAddress').value);
  const name = $('siteAdapter').value;
  if (!address) return say('Type an address like www.amazon.co.uk/gp/video: a host, with a path if the site lives under one.', 'bad');
  const problem = SL.addProblem(name, address, knownAddresses);
  if (problem) return say('Not added: ' + problem + '.', 'bad');
  const granted = await chrome.permissions.request({ origins: [SL.patternOf(address)] }).catch(() => false);
  if (!granted) return say('Not added: access to ' + SL.hostOf(address) + ' was not allowed.', 'bad');
  const addresses = { ...knownAddresses, [name]: [...(knownAddresses[name] || []), address] };
  const { sites = {} } = await chrome.storage.sync.get('sites');
  await chrome.storage.sync.set({ addresses, sites: { ...sites, [address]: true } });
  $('siteAddress').value = '';
  await loadSites();
  const row = siteRows.find((r) => r.address === address);
  if (row && typeof row.label.scrollIntoView === 'function') row.label.scrollIntoView({ block: 'nearest' });
  const own = SL.SITES[name].addresses.find((o) => SL.covers(address, o));
  // Two lines at most in the status line (options.html #status).
  say('Added ' + address + ' under ' + SL.SITES[name].label + (own ? ' (pages under ' + SL.pathOf(own) + ' keep its tick)' : '') + '. Reload any tab there.');
});

// The cross on an added address: the row goes, with its switch and its grant.
async function removeAddress(row) {
  const { addresses = {}, sites = {} } = await chrome.storage.sync.get(['addresses', 'sites']);
  const rest = (addresses[row.name] || []).filter((a) => a !== row.address);
  if (rest.length) addresses[row.name] = rest;
  else delete addresses[row.name];
  delete sites[row.address];
  await chrome.storage.sync.set({ addresses, sites });
  await chrome.permissions.remove({ origins: [SL.patternOf(row.address)] }).catch(() => {});
  await loadSites();
  say(row.address + ' removed.');
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
// changes a box, the same default as content.js and lookup.js). The
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
  // The note takes the place of the cost remark after On cards too, so the
  // row's tip stays on the line at larger font sizes.
  $('cardsCost').hidden = !keyOk;
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

// Deletes the database (build.js deleteDatabase) and reports in the
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

// Where ratings come from (sync ratingsSource, refresh.js omdbOnly).
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

// Every setting back to its default: the required sites on and the
// optional ones off, no added addresses, badges always with the star
// label, no extras, OMDb lookups on if there is a key, the local database
// with the default refresh. The key and the database stay.
const SETTING_KEYS = ['autoRefresh', 'ratingsDays', 'fullDays', 'ratingsSource', 'otherLanguages', 'titleLangs', 'sites', 'addresses', 'cardBadges', 'hideNA', 'badgeLabel', 'omdbFallback', 'extraRatings'];

$('resetSettings').addEventListener('click', async () => {
  if (!confirm('Reset every setting to its default? The OMDb key and the ratings database are kept.')) return;
  const { omdbKey = '' } = await chrome.storage.sync.get('omdbKey');
  // Optional sites and added addresses give their grants back: after the
  // reset nothing optional is on, and nothing is allowed that the list
  // no longer shows.
  for (const row of siteRows) {
    if (row.granted && needsGrant(row) && (row.address || !keepGrant(row))) await chrome.permissions.remove({ origins: patternsOf(row) }).catch(() => {});
  }
  await chrome.storage.sync.remove(SETTING_KEYS);
  // The languages seen on streaming pages (languages.js notePageLang)
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
  '1.3.0': 'Updated to 1.3.0. New under Sites: Letterboxd (tick it to allow it) and a row to add an address of your own.', // two lines at most, in Firefox’s wider font too
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
