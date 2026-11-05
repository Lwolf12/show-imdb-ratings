// The settings page's words: the status texts (what the database holds,
// what a running build is doing, what the next refresh is) and the small
// helpers every section uses ($, say, languageNames). Loaded before
// options-languages.js and options.js (options.html); the three share one
// global scope.

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
  const days = Math.floor((Date.now() - ts) / DAY_MS);
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

// What the database holds and when it was built: the full build's date,
// and the ratings pass's when it came later. A first run whose episode
// stage was interrupted has titles only until the next full rebuild. One
// built by an older version is rebuilt once by itself, unless the
// automatic refresh is off: then this line asks for it.
// manual: the full rebuild is Update now's alone (Advanced), so what waits
// for one says so.

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
