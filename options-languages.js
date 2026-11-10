// The settings page's "Match titles in other languages" section: the
// language list and its ticks (a draft until Apply or Get titles), the
// line over the picker, the button, and the box's own switch. Loaded after
// options-text.js and before options.js, whose refreshStats calls
// refreshLanguages with the background's report on every change.

// Everything the section knows, from the background's usage report
// (refreshLanguages) and the ticks (tickLanguages); no handler reads
// storage or the page itself, so the page and the background always
// agree on what is chosen.
//   on        the box: sync otherLanguages
//   chosen    the languages stored (sync titleLangs), kept while the box
//             is off, so on again shows the last applied choice
//   keyed     the languages the database matches now (meta.langs, with a
//             kept list)
//   draft     ticks not yet applied: the ticked languages when they differ
//             from chosen, else null
//   onHand    whether the kept list can key these languages: it exists and
//             dates from after each was added (usage langsNeed, db.js
//             AKAS_NEEDS); else Get titles reads the 520 MB file again
//   suggest   the languages worth pre-ticking the first time: the
//             browser's own and those seen on streaming pages
//   dbPresent, omdbOnly, building   the page's state the section depends on
const langs = { on: false, chosen: [], keyed: [], draft: null, onHand: () => false, suggest: [], dbPresent: false, omdbOnly: false, building: false };
const sameLangs = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// Fills the section from the usage report u and its database status l.
// failed: the build that failed last, if any (a languages pass's failure
// is reported here, where Get titles is).
function refreshLanguages(u, l, building, failed) {
  langs.on = !!u.langsOn;
  langs.chosen = u.langsChosen || [];
  langs.keyed = l.akasAt ? l.langs || [] : [];
  langs.dbPresent = !!l.present;
  langs.omdbOnly = !!u.omdbOnly;
  langs.building = !!building;
  langs.onHand = (list) => !!l.akasAt && (list || []).every((x) => ((u.langsNeed || {})[x] || 1) <= (l.akasFormat || 1));
  langs.suggest = [...new Set([...(u.langsBrowser || []), ...(u.langsPages || [])])];
  // A draft the store has caught up with (Apply went through) is done.
  if (langs.draft !== null && sameLangs(langs.draft, langs.chosen)) langs.draft = null;

  $('otherLangs').checked = langs.on;
  $('otherLangs').disabled = langs.omdbOnly;
  const listWasHidden = $('langBox').hidden;
  // Under OMDb only the box stays where it is, greyed: hiding it would
  // move Advanced up and down with the source choice.
  $('langBox').hidden = !langs.on;
  $('langBox').classList.toggle('off', langs.omdbOnly);
  renderLanguages(u, listWasHidden);
  const failedAkas = !!(failed && failed.kind === 'akas' && langs.on);
  $('otherLangsText').textContent = langs.omdbOnly ? 'Not used with OMDb only; the ticks are kept for switching back.'
    : failedAkas ? 'Get titles failed: ' + failed.message + '. Click Get titles to try again.'
    : otherLanguagesText(l);
  // Red while ticked languages cannot match yet: no database, or no list
  // of titles on hand (Get titles).
  $('otherLangsText').classList.toggle('bad', failedAkas || (langs.on && !langs.omdbOnly && !langs.building && langs.draft === null && langs.chosen.length > 0 && !langs.onHand(langs.chosen)));
  if (langs.on) $('forgetLine').hidden = true; // the offer belongs to the moment of unticking
  // The button applies the ticks: Get titles while the list was never
  // fetched, Apply once it is on hand and only the keys change. Shown for
  // a draft, or for languages chosen but never fetched. With nothing to
  // apply it is Refresh titles: a fresh list from IMDb now, whatever the
  // interval in Advanced (the date of the kept one is in the line above).
  const btn = $('downloadLangs');
  const waiting = langs.draft !== null || (langs.chosen.length > 0 && !langs.onHand(langs.chosen));
  const refresh = !waiting && langs.chosen.length > 0;
  btn.hidden = !(langs.on && langs.dbPresent && !langs.building && !langs.omdbOnly && (waiting || refresh));
  const apply = !refresh && langs.onHand(langs.draft || langs.chosen);
  btn.textContent = refresh ? 'Refresh titles' : apply ? 'Apply' : 'Get titles';
  btn.title = refresh ? 'Reads a fresh list from IMDb now (520 MB)' : apply ? 'From the kept list, no download' : 'Reads 520 MB from IMDb, keeps about 50 MB';
  // Red whenever it is the click that is waited for: a draft not applied
  // yet (Apply or Get titles), or ticked languages the list cannot key.
  btn.classList.toggle('needed', !refresh && (langs.draft !== null || (!apply && langs.chosen.length > 0)));
}

// The language list under "Match titles in other languages": every
// language the database can key (usage langsAll), by English name, the
// chosen ones ticked, with a hint on the browser's own language and on
// languages seen on streaming pages. Built once; later calls only update
// the ticks.
// The ticked languages come first, the rest alphabetically. The order is set
// while the list is out of sight (page load, box unticked), so a language
// ticked just now stays where it was until the list is next shown.
function renderLanguages(u, reorder) {
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
  const chosen = new Set(langs.draft || langs.chosen);
  const browser = new Set(u.langsBrowser || []);
  const pages = new Set(u.langsPages || []);
  for (const label of box.querySelectorAll('label')) {
    const input = label.querySelector('input');
    input.checked = chosen.has(input.value);
    input.disabled = langs.building || langs.omdbOnly;
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
  if (!langs.dbPresent) {
    // No database, so no Apply: the first build (Update now) reads the
    // choice from storage, and nothing can start before it.
    langs.draft = null;
    chrome.storage.sync.set({ titleLangs: ticked }).then(refreshStats);
    if (ticked.length) say('Titles in ' + (ticked.length > 3 ? ticked.length + ' languages' : languageNames(ticked)) + ' match after the first build (reads 520 MB more).', 'bad');
    else say('No language ticked.');
    return;
  }
  langs.draft = sameLangs(ticked, langs.chosen) ? null : ticked;
  refreshStats();
}

// Over the picker, one short line: where things stand. The explanation
// of the option itself is in its "i" tip; the option off shows nothing.
function otherLanguagesText(l) {
  const { on, chosen, draft, onHand, building } = langs;
  const have = l.langs || [];
  if (!on) return '';
  if (draft !== null && l.present && !building) {
    return 'Not applied yet: click ' + (onHand(draft) ? 'Apply' : 'Get titles') + ' to ' + (draft.length ? 'match titles in ' + languageNames(draft) : 'match no other language') + '. Nothing changes until then.';
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
  if (!sameLangs(chosen, have)) return 'Updating…' + kept;
  return (have.length ? 'Matched in ' + languageNames(have) + '.' : 'None ticked.') + kept;
}

// The box. Off: lookups stop using the keys at once; the keys, the kept
// list and the choice all stay, so on again is instant, with nothing to
// apply (languages.js applyLanguageChoice). Only with nothing chosen yet
// (the first time, or after Reset settings) do the languages seen come
// pre-ticked: as a draft with a database, with the "Not applied yet" line
// and the button; stored outright without one, since the first build
// reads the choice and nothing can start before it.
$('otherLangs').addEventListener('change', async () => {
  const on = $('otherLangs').checked;
  const keyed = langs.keyed;
  langs.draft = null;
  const writes = { otherLanguages: on };
  if (on && !langs.chosen.length) {
    if (langs.dbPresent) langs.draft = langs.suggest.length ? langs.suggest : null;
    else writes.titleLangs = langs.suggest;
  }
  await chrome.storage.sync.set(writes); // one write, one change event in the background
  say(!on ? 'Titles in other languages off; the kept list stays for turning it back on.'
    : langs.chosen.length && langs.dbPresent ? 'Titles in ' + languageNames(langs.chosen) + ' match again.'
    : langs.dbPresent ? 'Tick the languages to match, then click the button next to the box.'
    : 'Tick the languages to match; the first build includes them.');
  // Off with languages keyed: the ratings already matched in them stay
  // remembered (30 days, like any other), which looks as if the option
  // were still on. One line offers to forget them; leaving it is the default.
  $('forgetLine').hidden = on || !keyed.length;
  if (!on && keyed.length) $('forgetText').textContent = 'Ratings already matched in ' + languageNames(keyed) + ' stay remembered for up to 30 days.';
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
// the background keys it by itself on the write (languages.js
// applyLanguageChoice); otherwise the build message fetches the 520 MB,
// which only ever starts from this click. With no draft and the list on
// hand, the button is Refresh titles: the build message asks for a fresh
// file (fresh), keyed for the same languages.
$('downloadLangs').addEventListener('click', async () => {
  const list = langs.draft !== null ? langs.draft : langs.chosen;
  const refresh = langs.draft === null && list.length > 0 && langs.onHand(list);
  const fetches = refresh || (list.length > 0 && !langs.onHand(list)); // the 520 MB from datasets.imdbws.com
  if (fetches && !(await askImdbAccess())) return say(NO_IMDB_ACCESS, 'bad'); // Firefox's prompt, the click's first await
  $('downloadLangs').disabled = true;
  if (langs.draft !== null) {
    await chrome.storage.sync.set({ titleLangs: langs.draft });
    langs.chosen = langs.draft;
    langs.draft = null;
  }
  // No language left: the write above clears the keys by itself.
  if (fetches) showBuild(await chrome.runtime.sendMessage({ type: 'build', kind: 'akas', fresh: refresh }));
  $('downloadLangs').disabled = false;
  setTimeout(refreshStats, 500);
});
