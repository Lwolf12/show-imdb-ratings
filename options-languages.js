// The settings page's "Match titles in other languages" section: the
// language list and its ticks (a draft until Apply or Get titles), the
// line over the picker, and the box's own switch. Loaded after
// options-text.js and before options.js, which fills this section's state
// on every refreshStats.

let loadedLangs = []; // languages keyed in the database at the last refresh (refreshStats)
let storedLangs = []; // the languages chosen in storage at the last refresh
let extractOnHand = false; // the kept list exists, so changed ticks need no download
let onHand = () => false; // ...and covers these languages (refreshStats)
// The ticks are a draft until the button under the list is clicked: the
// ticked languages when they differ from storedLangs, else null.
let draftLangs = null;
const sameLangs = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

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
    input.disabled = !!building || omdbOnlyMode;
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
  if (!onHand(chosen)) {
    if (!chosen.length) return 'Tick the languages you use.';
    // A kept list from before some of these languages were added: the
    // others keep matching while the file is read again.
    const lacking = chosen.filter((x) => !onHand([x]));
    const keep = chosen.filter((x) => onHand([x]));
    return 'Not in use yet: titles in ' + languageNames(lacking) + ' only match after Get titles has run (reads 520 MB' + (keep.length ? '); ' + languageNames(keep) + ' keeps matching meanwhile.' : ', keeps about 50 MB).');
  }
  const kept = ' List from ' + new Date(l.akasAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' kept (' + Math.round(l.akasSize / 1048576) + ' MB).';
  if (building) return 'Changes apply after the current build.' + kept;
  if (chosen.length !== have.length || chosen.some((x) => !have.includes(x))) return 'Updating…' + kept;
  return (have.length ? 'Matched in ' + languageNames(have) + '.' : 'None ticked.') + kept;
}

// Off: lookups stop using the keys at once; the keys, the kept list and
// the ticks all stay, so on again is instant, with nothing to apply.
// Only before any Apply (nothing stored yet) do the languages seen on
// streaming pages come pre-ticked as a draft, with the "Not applied yet"
// line and the button.
$('otherLangs').addEventListener('change', async () => {
  const on = $('otherLangs').checked;
  const loaded = loadedLangs; // before the write: the worker clears them on it
  draftLangs = null;
  const writes = { otherLanguages: on };
  if (on) {
    const { titleLangs } = await chrome.storage.sync.get('titleLangs');
    const stored = Array.isArray(titleLangs) ? titleLangs : [];
    if (stored.length) {
      storedLangs = stored;
    } else {
      const seen = [...$('langList').querySelectorAll('label')].filter((lb) => lb.querySelector('.hint').textContent).map((lb) => lb.querySelector('input').value);
      draftLangs = seen.length && dbPresent ? seen : null; // no database: stored outright, the first build reads it
      storedLangs = dbPresent ? [] : seen;
      writes.titleLangs = dbPresent ? [] : seen;
    }
  }
  await chrome.storage.sync.set(writes); // one write, one change event in the worker
  say(!on ? 'Titles in other languages off; the kept list stays for turning it back on.'
    : storedLangs.length && dbPresent ? 'Titles in ' + languageNames(storedLangs) + ' match again.'
    : dbPresent ? 'Tick the languages to match, then click the button next to the box.'
    : 'Tick the languages to match; Update now then builds the database with them.');
  // Off with languages loaded: the ratings already matched in them stay
  // remembered (30 days, like any other), which looks as if the option
  // were still on. One line offers to forget them; leaving it is the default.
  $('forgetLine').hidden = on || !loaded.length;
  if (!on && loaded.length) $('forgetText').textContent = 'Ratings already matched in ' + languageNames(loaded) + ' stay remembered for up to 30 days.';
  // Off: the list goes now, not when refreshStats runs half a second on,
  // or the forget line shows under the list for that moment.
  if (!on) $('langBox').hidden = true;
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

// Applies the draft. With the kept list on hand and covering the choice,
// the worker keys it by itself on the write (background.js
// applyLanguageChoice); otherwise the build message fetches the 520 MB,
// which only ever starts from this click.
$('downloadLangs').addEventListener('click', async () => {
  $('downloadLangs').disabled = true;
  const langs = draftLangs !== null ? draftLangs : storedLangs;
  if (draftLangs !== null) {
    await chrome.storage.sync.set({ titleLangs: draftLangs });
    draftLangs = null;
  }
  // No language left: the write above clears the keys by itself.
  if (langs.length && !onHand(langs)) showBuild(await chrome.runtime.sendMessage({ type: 'build', kind: 'akas' }));
  $('downloadLangs').disabled = false;
  setTimeout(refreshStats, 500);
});
