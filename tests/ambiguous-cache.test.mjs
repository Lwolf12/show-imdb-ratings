// A database answer remembered before 1.3.7 has no ambiguous flag, so a
// card could keep a same-named film's rating for a month (lookup.js
// predatesAmbiguous): such an answer is asked of the database again, once;
// one that has the flag is used as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStorage, loadBackground, builtMeta } from './harness.mjs';

const film = { rating: 6.8, votes: '300,000', year: '2001', imdbID: 'tt0212985', kind: 'movie', matchedTitle: 'Hannibal', source: 'local', built: '2026-11-01' };

function setup(stored) {
  const storage = makeStorage({ local: { 'r:hannibal': { ...stored, ts: Date.now() } } });
  const bg = loadBackground({ storage, meta: builtMeta() });
  const asked = [];
  bg.call('RatingsDB').lookup = async (title, kind) => {
    asked.push([title, kind]);
    return { ...film, ambiguous: true };
  };
  return { bg, asked, storage };
}

test('a remembered database answer without the flag is asked again', async () => {
  const { bg, asked } = setup(film);
  const r = await bg.call('lookup')('Hannibal', null, false, null);
  assert.deepEqual(asked, [['Hannibal', null]]);
  assert.equal(r.ambiguous, true);
  // Now remembered with the flag: not asked a second time.
  await bg.call('lookup')('Hannibal', null, false, null);
  assert.equal(asked.length, 1);
});

test('a remembered answer that has the flag is used as it is', async () => {
  const { bg, asked } = setup({ ...film, ambiguous: false });
  const r = await bg.call('lookup')('Hannibal', null, false, null);
  assert.equal(asked.length, 0);
  assert.equal(r.ambiguous, false);
});

test('an OMDb answer is not affected', async () => {
  const { bg, asked } = setup({ ...film, source: 'omdb' });
  await bg.call('lookup')('Hannibal', null, false, null);
  assert.equal(asked.length, 0);
});

test('under OMDb only a remembered database answer is used as before, not sent to OMDb', async () => {
  const storage = makeStorage({ sync: { ratingsSource: 'omdb', omdbKey: 'k' }, local: { 'r:hannibal': { ...film, ts: Date.now() } } });
  const bg = loadBackground({ storage, meta: builtMeta() });
  const asked = [];
  bg.call('RatingsDB').lookup = async () => { asked.push('db'); return null; };
  const omdb = [];
  bg.ctx.fetch = async (url) => { omdb.push(url); throw new Error('offline'); };
  const r = await bg.call('lookup')('Hannibal', null, false, null);
  assert.equal(r.rating, 6.8);
  assert.equal(asked.length, 0);
  assert.equal(omdb.length, 0, 'no OMDb request');
});
