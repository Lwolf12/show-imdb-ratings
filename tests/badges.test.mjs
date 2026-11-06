// The badge settings on the settings page: the Compact badges tick (1.3.1)
// is stored, loaded and reset like the others.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStorage, loadBackground, loadOptions, settle } from './harness.mjs';

async function page(sync = {}) {
  const storage = makeStorage({ sync });
  const background = loadBackground({ storage });
  const options = loadOptions({ storage, background });
  await settle();
  return { storage, options };
}

test('Compact badges: off by default, stored on a tick, shown ticked on load', async () => {
  const { storage, options } = await page();
  const box = options.$('compactBadges');
  assert.equal(box.checked, false);
  box.checked = true;
  await box.dispatch('change');
  assert.equal(storage.areas.sync.compactBadges, true);
  assert.match(options.$('status').textContent, /Compact card badges/);

  const again = await page({ compactBadges: true });
  assert.equal(again.options.$('compactBadges').checked, true);
});

test('Reset settings drops it', async () => {
  const { storage, options } = await page({ compactBadges: true });
  await options.$('resetSettings').dispatch('click');
  await settle();
  assert.equal(storage.areas.sync.compactBadges, undefined);
  assert.equal(options.$('compactBadges').checked, false);
});
