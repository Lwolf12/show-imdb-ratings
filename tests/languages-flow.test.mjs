// The "Match titles in other languages" flow, settings page and background
// together (tests/harness.mjs): what a tick, the box and Apply write, and
// what the background does with it. These are the paths that went wrong
// in 1.2.3's settings work: a tick that emptied the choice, off/on asking
// for Apply, Reset leaving stale keys, and the alarm removing keys the off
// switch had kept.
import { test } from 'node:test';
import assert from 'node:assert';
import { makeStorage, loadBackground, loadOptions, builtMeta, settle, DB } from './harness.mjs';

const day = 24 * 60 * 60 * 1000;
// A database with a kept list that keys these languages.
const keyedMeta = (langs) => builtMeta({ langs, akasAt: Date.now() - day, akasFormat: DB.AKAS_FORMAT, akasSize: 50e6, akas: 1000 });

function setUp({ sync = {}, meta = null, file = null, languages = ['en-US', 'pl-PL'] } = {}) {
  const storage = makeStorage({ sync });
  const bg = loadBackground({ storage, meta, file, languages });
  const page = loadOptions({ storage, background: bg });
  const builds = () => bg.sent.filter((m) => m.target === 'offscreen' && m.type === 'build');
  const tick = async (code, on = true) => {
    const row = page.langRow(code);
    assert.ok(row, 'a row for ' + code);
    row.checked = on;
    await row.dispatch('change');
    await settle(50);
  };
  const box = async (on) => {
    page.$('otherLangs').checked = on;
    await page.$('otherLangs').dispatch('change');
    await settle(600); // the handler refreshes half a second on
  };
  return { storage, bg, page, builds, tick, box, $: page.$ };
}

// Nothing to apply: the button is Refresh titles (a fresh list on request), not red.
function refreshOffered(t) {
  assert.strictEqual(t.$('downloadLangs').hidden, false);
  assert.strictEqual(t.$('downloadLangs').textContent, 'Refresh titles');
  assert.strictEqual(t.$('downloadLangs').classList.contains('needed'), false);
}

test('first time on with a database: the languages seen come pre-ticked as a draft, stored only by Get titles', async () => {
  const t = setUp({ meta: builtMeta() });
  await settle(100);
  assert.strictEqual(t.$('langBox').hidden, true);
  await t.box(true);
  assert.strictEqual(t.$('langBox').hidden, false);
  assert.deepEqual(t.page.ticked(), ['pl'], 'the browser language is pre-ticked');
  assert.strictEqual(t.storage.areas.sync.titleLangs, undefined, 'nothing stored yet');
  assert.match(t.$('otherLangsText').textContent, /^Not applied yet: click Get titles/);
  assert.strictEqual(t.$('downloadLangs').hidden, false);
  assert.strictEqual(t.$('downloadLangs').textContent, 'Get titles');
  assert.ok(t.$('downloadLangs').classList.contains('needed'));
  assert.strictEqual(t.builds().length, 0, 'nothing started by itself');

  await t.$('downloadLangs').dispatch('click');
  await settle(600);
  assert.deepEqual(t.storage.areas.sync.titleLangs, ['pl']);
  assert.deepEqual(t.builds().map((b) => [b.kind, b.langs]), [['akas', ['pl']]], 'the click fetches the file for Polish');
  await t.bg.finishBuild();
  await settle(600);
  assert.match(t.$('otherLangsText').textContent, /^Matched in Polish\./);
  refreshOffered(t); // nothing to apply: the button offers a fresh list
  assert.strictEqual(t.$('otherLangsText').classList.contains('bad'), false);
});

test('off and on again: no Apply, no build, the keys and the choice stay, the alarm removes nothing', async () => {
  const t = setUp({ sync: { otherLanguages: true, titleLangs: ['pl'] }, meta: keyedMeta(['pl']), file: {} });
  await settle(100);
  assert.deepEqual(t.page.ticked(), ['pl']);
  assert.match(t.$('otherLangsText').textContent, /^Matched in Polish\./);

  await t.box(false);
  assert.strictEqual(t.$('langBox').hidden, true);
  assert.strictEqual(t.$('forgetLine').hidden, false, 'the offer to forget the matched ratings');
  assert.match(t.$('forgetText').textContent, /matched in Polish stay remembered/);
  assert.deepEqual(t.storage.areas.sync.titleLangs, ['pl'], 'the choice stays stored');
  assert.deepEqual(t.bg.db.meta.langs, ['pl'], 'the keys stay');
  assert.deepEqual(t.bg.db.log, [], 'nothing cleared');
  assert.strictEqual(t.builds().length, 0);
  assert.doesNotMatch(t.$('nextRefresh').textContent, /other language|Polish/, 'no refresh planned around the languages');
  // The six-hourly check with the box off: the keys are not its business.
  await t.bg.call('maybeRefresh()');
  await settle(50);
  assert.strictEqual(t.builds().length, 0, 'the alarm starts no pass to remove the keys');

  await t.box(true);
  assert.deepEqual(t.page.ticked(), ['pl'], 'the last applied choice shows again');
  refreshOffered(t); // nothing to apply: the button offers a fresh list
  assert.match(t.$('otherLangsText').textContent, /^Matched in Polish\./);
  assert.strictEqual(t.$('status').textContent, 'Titles in Polish match again.');
  assert.strictEqual(t.builds().length, 0);
  assert.deepEqual(t.bg.db.log, []);
});

test('Reset settings drops the keys; on again then suggests, and starts nothing by itself', async () => {
  const t = setUp({ sync: { otherLanguages: true, titleLangs: ['pl', 'de'] }, meta: keyedMeta(['pl', 'de']), file: {} });
  await settle(100);
  await t.$('resetSettings').dispatch('click');
  await settle(300);
  assert.strictEqual(t.storage.areas.sync.titleLangs, undefined);
  assert.strictEqual(t.storage.areas.sync.otherLanguages, undefined);
  assert.deepEqual(t.bg.db.log, ['clearAkas'], 'the keys of a choice no longer stored go');
  assert.deepEqual(t.bg.db.meta.langs, []);
  assert.strictEqual(t.$('langBox').hidden, true);
  assert.strictEqual(t.builds().length, 0);

  await t.box(true);
  assert.deepEqual(t.page.ticked(), ['pl'], 'the browser language is suggested, not the old six');
  assert.strictEqual(t.storage.areas.sync.titleLangs, undefined, 'a suggestion, not a choice');
  assert.strictEqual(t.$('downloadLangs').textContent, 'Apply', 'the kept list covers it');
  assert.match(t.$('otherLangsText').textContent, /^Not applied yet: click Apply/);
  assert.strictEqual(t.builds().length, 0, 'nothing runs until the click');
});

test('unticking one language and Apply keys the rest from the kept list, by the background on the write', async () => {
  const t = setUp({ sync: { otherLanguages: true, titleLangs: ['pl', 'de'] }, meta: keyedMeta(['pl', 'de']), file: {} });
  await settle(100);
  await t.tick('de', false);
  assert.match(t.$('otherLangsText').textContent, /^Not applied yet: click Apply to match titles in Polish\./);
  assert.strictEqual(t.$('downloadLangs').textContent, 'Apply');
  assert.deepEqual(t.storage.areas.sync.titleLangs, ['pl', 'de'], 'a draft only');
  // Ticking it back is the way to change one's mind: nothing to apply.
  await t.tick('de', true);
  refreshOffered(t); // nothing to apply: the button offers a fresh list
  await t.tick('de', false);

  await t.$('downloadLangs').dispatch('click');
  await settle(600);
  assert.deepEqual(t.storage.areas.sync.titleLangs, ['pl']);
  assert.deepEqual(t.builds().map((b) => [b.kind, b.langs]), [['akas', ['pl']]], 'keyed again from the extract, no download');
  assert.strictEqual(t.$('downloadLangs').hidden, true);
  await t.bg.finishBuild();
  await settle(600);
  assert.match(t.$('otherLangsText').textContent, /^Matched in Polish\./);
});

test('a language the kept list predates needs Get titles, and the others keep matching', async () => {
  const newer = Object.keys(DB.AKAS_NEEDS).find((l) => DB.AKAS_NEEDS[l] > 1);
  assert.ok(newer, 'db.js AKAS_NEEDS names a language a format-1 extract lacks');
  const t = setUp({ sync: { otherLanguages: true, titleLangs: ['pl'] }, meta: builtMeta({ langs: ['pl'], akasAt: Date.now() - day, akasFormat: 1, akasSize: 50e6, akas: 1000 }), file: {} });
  await settle(100);
  refreshOffered(t); // nothing to apply: the button offers a fresh list
  await t.tick(newer);
  assert.strictEqual(t.$('downloadLangs').textContent, 'Get titles');
  assert.match(t.$('otherLangsText').textContent, /^Not applied yet: click Get titles/);
  await t.$('downloadLangs').dispatch('click');
  await settle(600);
  assert.deepEqual([...t.storage.areas.sync.titleLangs].sort(), ['pl', newer].sort());
  const started = t.builds();
  assert.strictEqual(started.length, 1, 'one pass: the file is read again');
  assert.deepEqual([...started[0].langs].sort(), ['pl', newer].sort());
});

test('without a database a tick is stored at once, for the first build to read', async () => {
  const t = setUp({ meta: null });
  await settle(100);
  await t.box(true);
  assert.deepEqual(t.storage.areas.sync.titleLangs, ['pl'], 'the suggestion is the choice: nothing can be applied yet');
  assert.strictEqual(t.$('downloadLangs').hidden, true);
  await t.tick('de');
  assert.deepEqual(t.storage.areas.sync.titleLangs, ['pl', 'de']);
  assert.match(t.$('status').textContent, /^Titles in Polish and German match after the first build/);
  assert.strictEqual(t.$('status').className, 'bad');
  assert.strictEqual(t.builds().length, 0);
});

test('under OMDb only the section is greyed, the ticks kept', async () => {
  const t = setUp({ sync: { otherLanguages: true, titleLangs: ['pl'], ratingsSource: 'omdb' }, meta: keyedMeta(['pl']), file: {} });
  await settle(100);
  assert.strictEqual(t.$('otherLangs').disabled, true);
  assert.ok(t.$('langBox').classList.contains('off'));
  assert.strictEqual(t.$('langBox').hidden, false, 'stays in place');
  assert.strictEqual(t.page.langRow('pl').disabled, true);
  assert.deepEqual(t.page.ticked(), ['pl']);
  assert.strictEqual(t.$('otherLangsText').textContent, 'Not used with OMDb only; the ticks are kept for switching back.');
  assert.strictEqual(t.$('downloadLangs').hidden, true);
});

test('a change made during a build waits for the build to end', async () => {
  const t = setUp({ sync: { otherLanguages: true, titleLangs: ['pl'] }, meta: keyedMeta(['pl']), file: {} });
  await settle(100);
  await t.bg.message({ type: 'build' }); // Update now
  await settle(50);
  assert.strictEqual(t.builds().length, 1);
  await t.storage.sync.set({ titleLangs: ['pl', 'de'] });
  await settle(100);
  assert.strictEqual(t.builds().length, 1, 'held back while the build runs');
  await t.bg.finishBuild({ titles: 420000 });
  await settle(100);
  assert.deepEqual(t.builds().map((b) => [b.kind, b.langs]), [['full', ['pl']], ['akas', ['pl', 'de']]], 'applied once the build is done');
});

test('Refresh titles reads a fresh list for the languages matched, the ticks unchanged', async () => {
  const t = setUp({ sync: { otherLanguages: true, titleLangs: ['pl'] }, meta: builtMeta({ langs: ['pl'], akasAt: Date.now() - 10 * day, akasFormat: DB.AKAS_FORMAT, akasSize: 50e6, akas: 1000 }), file: {} });
  await settle(100);
  refreshOffered(t);
  await t.$('downloadLangs').dispatch('click'); // ten days old: no second click asked
  await settle(600);
  const started = t.builds();
  assert.strictEqual(started.length, 1);
  assert.strictEqual(started[0].kind, 'akas');
  assert.strictEqual(started[0].fresh, true, 'a fresh file, not the kept one');
  assert.deepEqual([...started[0].langs], ['pl']);
  assert.deepEqual(t.storage.areas.sync.titleLangs, ['pl']);
});

test('a list read in the last week asks for a second click first, like Update now', async () => {
  const t = setUp({ sync: { otherLanguages: true, titleLangs: ['pl'] }, meta: keyedMeta(['pl']), file: {} }); // read a day ago
  await settle(100);
  await t.$('downloadLangs').dispatch('click');
  await settle(600);
  assert.strictEqual(t.builds().length, 0, 'the first click only warns');
  assert.strictEqual(t.$('langNote').hidden, false);
  assert.match(t.$('langNote').textContent, /^List read (1 day|2\d hours) ago, so it is current\. Click again to read it anyway \(520 MB\)\.$/);
  await t.$('downloadLangs').dispatch('click');
  await settle(600);
  assert.strictEqual(t.builds().length, 1, 'the second click reads it');
  assert.strictEqual(t.builds()[0].fresh, true);
  assert.strictEqual(t.$('langNote').hidden, true);
});
