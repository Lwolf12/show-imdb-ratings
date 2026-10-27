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
};

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

// ------------------------------------------------------------ database

// The green "All set" box is for a build that just finished; the session
// keeps the done state until the browser restarts, and an hours-old one is
// already covered by the "built today" line above.
const DONE_RECENT_MS = 10 * 60 * 1000;

function showBuild(build) {
  const box = $('buildProgress');
  const btn = $('build');
  $('buildDone').hidden = true;
  if (!build || build.status === 'idle') {
    box.hidden = true;
    btn.disabled = false;
    return;
  }
  if (build.status === 'done') {
    box.hidden = true;
    btn.disabled = false;
    if (Date.now() - (build.at || 0) < DONE_RECENT_MS) {
      $('doneText').textContent = build.kind === 'ratings'
        ? 'Ratings updated' + (build.info.unknown ? '; ' + WAITING(build.info.unknown) + '.' : '.')
        : build.info.titles.toLocaleString() + ' titles. Ratings now show on the streaming sites ' +
          '(reload any that are already open).';
      $('buildDone').hidden = false;
    }
    return;
  }
  if (build.status === 'running') {
    box.hidden = false;
    btn.disabled = true;
    $('buildBar').value = build.pct || 0;
    const unit = { basics: ' titles', episodes: ' episodes' }[build.phase];
    const detail = unit && build.detail ? ' (' + build.detail.toLocaleString() + unit + ' so far)' : '';
    // A full build's titles go live before the episodes download.
    const usable = build.usable ? 'Ratings now show on the streaming sites (reload any that are already open). ' : '';
    $('buildText').textContent = usable + (PHASES[build.phase] || build.phase) + ' ' + Math.round((build.pct || 0) * 100) + '%' + detail;
    return;
  }
  box.hidden = false;
  btn.disabled = false;
  $('buildBar').value = 0;
  $('buildText').textContent = 'Failed: ' + build.message + ' (will retry automatically in a day)';
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
  $('localStatus').textContent = !l.present ? 'Not built yet. Click Update now; it takes a few minutes.' : localStatus(l, building);
  $('nextRefresh').textContent = l.present && !building ? nextRefresh(u) : '';
  $('auto').checked = u.autoRefresh !== false;
  showBuild(u.build);
  $('stored').textContent = u.stored.toLocaleString();
  $('today').textContent = u.today.toLocaleString();
  $('limit').textContent = u.limitHit ? '(limit reached; paused for now)' : '';
  loadExtras(u.keyOk);
}

// What the database holds and when it was built: the full build's date,
// and the ratings pass's when it came later. A first run whose episode
// stage was interrupted has titles only until the next full rebuild. One
// built by an older version is rebuilt once by itself, unless the
// automatic refresh is off: then this line asks for it.
function localStatus(l, building) {
  let s = l.titles.toLocaleString() + ' titles' + (l.episodes ? ' and ' + l.episodes.toLocaleString() + ' episodes' : '') +
    ', built ' + l.built + ' (' + ago(l.builtAt) + ')';
  if (l.ratingsAt > l.builtAt) s += '; ratings updated ' + l.ratingsBuilt + ' (' + ago(l.ratingsAt) + ')';
  s += '.';
  if (l.unknown) s += ' ' + WAITING(l.unknown).replace(/^./, (c) => c.toUpperCase()) + '.';
  if (!l.episodes) s += building ? ' Episode ratings are still downloading.' : ' Episode ratings arrive with the next full rebuild.';
  if (l.outdated) s += ' Built by an older version; the next automatic refresh rebuilds it (or click Update now).';
  return s;
}

// The next automatic refresh (background.js refreshPlan): which kind, what
// it downloads and when, and how new titles arrive for people without an
// OMDb key.
function nextRefresh(u) {
  const n = u.next || {};
  if (u.autoRefresh === false) return 'Automatic refresh is off. Update now rebuilds everything (about 280 MB).';
  if (!n.kind) return '';
  if (n.kind === 'ratings') {
    return 'Next: ratings only (about ' + n.mb + ' MB), ' + due(n.due) + '. New titles arrive with the full rebuild' +
      (n.keyed ? ' (every three months; OMDb covers them meanwhile).' : ' (about monthly); an OMDb key covers them sooner.');
  }
  const why = {
    unknown: 'many newly rated titles are waiting',
    episodes: 'the episode list never finished',
    format: 'it was built by an older version',
  }[n.reason];
  return 'Next: full rebuild (about ' + n.mb + ' MB), ' + due(n.due) + (why ? ', because ' + why : '') + '.';
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

$('auto').addEventListener('change', async () => {
  await chrome.storage.sync.set({ autoRefresh: $('auto').checked });
  say($('auto').checked ? 'Automatic refresh on: ratings weekly, the full title list about monthly.' : 'Automatic refresh off; use Update now when you want.');
  refreshStats();
});

// Live progress while a build runs: the worker writes its state to session
// storage, which fires this for every update.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.buildState) {
    const s = changes.buildState.newValue;
    showBuild(s);
    if (s && (s.status === 'done' || s.status === 'error')) refreshStats();
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
  const { cardBadges = 'always', hideNA = false, badgeLabel = 'star' } =
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
// Ticking it reveals the key fields; unticking disables the fallback but
// keeps the key so it can be turned back on without re-entering it.
async function loadOmdb() {
  const { omdbKey = '', omdbFallback = true } = await chrome.storage.sync.get(['omdbKey', 'omdbFallback']);
  $('key').value = omdbKey;
  const on = !!omdbKey && omdbFallback && (await omdbConsent());
  $('useOmdb').checked = on;
  $('omdbBox').hidden = !on;
}

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
  $('omdbBox').hidden = !on;
  await chrome.storage.sync.set({ omdbFallback: on });
  if (on && !$('key').value.trim()) $('key').focus();
  else say(on ? 'OMDb lookups on.' : 'OMDb lookups off.');
});

$('save').addEventListener('click', async () => {
  const omdbKey = $('key').value.trim();
  if (omdbKey && !(await askOmdbConsent())) return say(NO_CONSENT, 'bad');
  await chrome.storage.sync.set({ omdbKey, omdbFallback: !!omdbKey });
  // A new key means an earlier "limit reached" pause no longer applies.
  await chrome.storage.local.remove(['limitHitDay', 'limitPauseUntil']);
  say(omdbKey ? 'Key saved.' : 'Key cleared.');
  refreshStats();
});

$('test').addEventListener('click', async () => {
  const out = $('testResult');
  const omdbKey = $('key').value.trim();
  if (omdbKey && !(await askOmdbConsent())) {
    out.className = 'bad';
    out.textContent = NO_CONSENT;
    return;
  }
  out.className = '';
  out.textContent = 'Testing…';
  // Test whatever is in the box, saving it first so the worker sees it.
  await chrome.storage.sync.set({ omdbKey, omdbFallback: !!omdbKey });
  let r;
  try {
    r = await chrome.runtime.sendMessage({ type: 'test' });
  } catch (e) {
    r = null;
  }
  if (!r) {
    out.className = 'bad';
    out.textContent = STALE_WORKER;
    return;
  }
  out.className = r.ok ? 'ok' : 'bad';
  out.textContent = (r.ok ? 'OK: ' : 'Failed: ') + r.detail;
  refreshStats();
});

// Extra scores from OMDb (sync extraRatings {rt, mc, awards}). The boxes are
// greyed out, with a note, until the saved key is confirmed working (a
// passed Test, or any OMDb answer); ticks are kept while greyed, so they
// apply again once the key works.
const EXTRA_BOXES = [...document.querySelectorAll('input.extra')];

async function loadExtras(keyOk) {
  const { extraRatings = {} } = await chrome.storage.sync.get('extraRatings');
  for (const box of EXTRA_BOXES) {
    box.checked = !!extraRatings[box.dataset.extra];
    box.disabled = !keyOk;
  }
  $('xAll').disabled = !keyOk;
  $('extras').classList.toggle('off', !keyOk);
  $('extrasNote').hidden = !!keyOk;
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

// One click for all four, for the people who tick them every time.
$('xAll').addEventListener('click', async () => {
  for (const b of EXTRA_BOXES) b.checked = true;
  await saveExtras();
  say('Rotten Tomatoes, Metacritic, Awards and On cards too on.');
});

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

$('deleteDb').addEventListener('click', async () => {
  if (!confirm('Delete the local ratings database? Ratings then come from OMDb only (if set up) until you click Update now, which downloads about 280 MB again.')) return;
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
    say('Database deleted' + (r.forgotten ? ', with ' + r.forgotten.toLocaleString() + ' ratings remembered from it' : '') + '. Reload open streaming tabs to see the change.');
  } else say('Could not delete the database: ' + ((r && r.message) || 'no answer from the extension') + '.', 'bad');
  refreshStats();
});

// ------------------------------------------------------------------ go

$('version').textContent = 'Version ' + chrome.runtime.getManifest().version;
loadSites();
loadBadges();
loadOmdb();
refreshStats();
