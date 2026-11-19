// The settings page's OMDb fold (1.4.0): closed on a new install, whose
// status line names the one thing to do, and open by itself for anyone
// using OMDb, so nothing they use is hidden.
import { test } from 'node:test';
import assert from 'node:assert';
import { makeStorage, loadBackground, loadOptions, builtMeta, settle } from './harness.mjs';

async function open({ sync = {}, meta = null } = {}) {
  const storage = makeStorage({ sync });
  const bg = loadBackground({ storage, meta });
  const page = loadOptions({ storage, background: bg });
  await settle(100);
  return page;
}

test('a new install: the fold stays closed and the status line asks only for Update now', async () => {
  const page = await open();
  assert.ok(!page.$('omdbFold').open);
  assert.strictEqual(page.$('localStatus').textContent, 'No ratings yet: click Update now to build the database (a few minutes).');
  assert.ok(page.$('localStatus').classList.contains('bad'));
});

test('a database and no key: the fold stays closed', async () => {
  const page = await open({ meta: builtMeta() });
  assert.ok(!page.$('omdbFold').open);
});

test('a key in use opens the fold', async () => {
  const page = await open({ sync: { omdbKey: 'k1234567', omdbFallback: true }, meta: builtMeta() });
  assert.strictEqual(page.$('omdbFold').open, true);
  assert.strictEqual(page.$('useOmdb').checked, true);
});

test('OMDb only opens the fold, key or not', async () => {
  const page = await open({ sync: { ratingsSource: 'omdb' } });
  assert.strictEqual(page.$('omdbFold').open, true);
  assert.strictEqual(page.$('omdbOnly').checked, true);
});

test('the OMDb only tick stores the source, and unticking puts the local database back', async () => {
  const page = await open({ sync: { omdbKey: 'k1234567', omdbFallback: true }, meta: builtMeta() });
  assert.ok(!page.$('omdbOnly').checked);
  page.$('omdbOnly').checked = true;
  await page.$('omdbOnly').dispatch('change');
  await settle(100);
  assert.strictEqual((await page.ctx.chrome.storage.sync.get('ratingsSource')).ratingsSource, 'omdb');
  assert.strictEqual(page.$('useOmdb').checked, true);
  assert.strictEqual(page.$('useOmdb').disabled, true);
  page.$('omdbOnly').checked = false;
  await page.$('omdbOnly').dispatch('change');
  await settle(100);
  assert.strictEqual((await page.ctx.chrome.storage.sync.get('ratingsSource')).ratingsSource, 'local');
  assert.strictEqual(page.$('useOmdb').disabled, false);
});

test('a stored key with Use OMDb off leaves the fold closed', async () => {
  const page = await open({ sync: { omdbKey: 'k1234567', omdbFallback: false }, meta: builtMeta() });
  assert.ok(!page.$('omdbFold').open);
  assert.strictEqual(page.$('useOmdb').checked, false);
});
