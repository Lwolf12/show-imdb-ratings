// How often the list of titles in other languages is read again (sync
// akasDays, Advanced: every 3 or 6 months, yearly, or only on Refresh
// titles) and the Refresh titles button's fresh read. The automatic side
// rides on the rebuilds, so the one Refresh automatically switch still
// stops it along with every other download.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStorage, loadBackground, builtMeta, settle, DB } from './harness.mjs';

const DAY = 24 * 60 * 60 * 1000;
const kept = (daysOld) => builtMeta({ akasAt: Date.now() - daysOld * DAY, akasSize: 40 * 1048576, akasFormat: DB.AKAS_FORMAT, langs: ['pl'] });

test('a kept list is stale after the chosen interval, never with 0', () => {
  const m = kept(100);
  assert.equal(DB.akasStale(m), true); // the default, 91 days
  assert.equal(DB.akasStale(m, 91), true);
  assert.equal(DB.akasStale(m, 182), false);
  assert.equal(DB.akasStale(m, 0), false);
  assert.equal(DB.akasStale(kept(400), 365), true);
  assert.equal(DB.akasStale(builtMeta(), 91), false); // no list kept: not stale
});

function background(sync, meta) {
  const storage = makeStorage({ sync: { otherLanguages: true, titleLangs: ['pl'], ...sync } });
  return loadBackground({ storage, meta });
}

test('the interval in force: the choice, else three months', async () => {
  const intervals = async (sync) => background(sync, kept(1)).call('refreshIntervals')();
  assert.equal((await intervals({})).akasDays, 91);
  assert.equal((await intervals({ akasDays: 365 })).akasDays, 365);
  assert.equal((await intervals({ akasDays: 0 })).akasDays, 0);
  assert.equal((await intervals({ akasDays: 45 })).akasDays, 91); // not offered: unset
});

test('a rebuild includes a fresh list only once the chosen interval has passed', async () => {
  const plan = async (sync) => {
    const bg = background(sync, kept(100));
    return bg.call('refreshPlan')(bg.db.meta);
  };
  assert.equal((await plan({})).akas, true);
  assert.equal((await plan({ akasDays: 182 })).akas, false);
  assert.equal((await plan({ akasDays: 0 })).akas, false);
});

test('Refresh titles asks the build page for a fresh list, with the interval', async () => {
  const bg = background({ akasDays: 182 }, kept(5));
  await bg.message({ type: 'build', kind: 'akas', fresh: true });
  await settle();
  const start = bg.sent.filter((m) => m.target === 'offscreen' && m.type === 'build').pop();
  assert.equal(start.kind, 'akas');
  assert.equal(start.fresh, true);
  assert.equal(start.akasDays, 182);
  assert.deepEqual([...start.langs], ['pl']);
});

test('Get titles and Update now do not ask for a fresh list', async () => {
  const bg = background({}, kept(5));
  await bg.message({ type: 'build', kind: 'akas' });
  await settle();
  const start = bg.sent.filter((m) => m.target === 'offscreen' && m.type === 'build').pop();
  assert.equal(start.fresh, false);
  assert.equal(start.akasDays, 91);
});
