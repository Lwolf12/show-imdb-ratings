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

test('Compact badges: on by default, stored on an untick, shown unticked on load', async () => {
  const { storage, options } = await page();
  const box = options.$('compactBadges');
  assert.equal(box.checked, true);
  box.checked = false;
  await box.dispatch('change');
  assert.equal(storage.areas.sync.compactBadges, false);
  assert.match(options.$('status').textContent, /Full-size card badges/);

  const again = await page({ compactBadges: false });
  assert.equal(again.options.$('compactBadges').checked, false);
});

test('Reset settings brings the default back', async () => {
  const { storage, options } = await page({ compactBadges: false });
  await options.$('resetSettings').dispatch('click');
  await settle();
  assert.equal(storage.areas.sync.compactBadges, undefined);
  assert.equal(options.$('compactBadges').checked, true);
});
