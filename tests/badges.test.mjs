// The badge settings on the settings page: the badge size (1.3.1) is
// stored, loaded, shown on the page's own samples and reset like the others.
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
const radios = (options) => options.document.querySelectorAll('input[name=badgeSize]');
const chosen = (options) => radios(options).find((r) => r.checked)?.value;
const pageClass = (options) => options.document.documentElement.className;

test('badge size: medium by default, stored on a click, the page carries the class for its samples', async () => {
  const { storage, options } = await page();
  assert.equal(chosen(options), 'medium');
  assert.equal(pageClass(options), 'imdbext-size-medium');
  const large = radios(options).find((r) => r.value === 'large');
  large.checked = true;
  radios(options).find((r) => r.value === 'medium').checked = false;
  await large.dispatch('change');
  assert.equal(storage.areas.sync.badgeSize, 'large');
  assert.equal(pageClass(options), 'imdbext-size-large');
  assert.match(options.$('status').textContent, /Large card badges/);

  const again = await page({ badgeSize: 'small' });
  assert.equal(chosen(again.options), 'small');
  assert.equal(pageClass(again.options), 'imdbext-size-small');
});

test('an unknown stored size shows as medium; Reset settings brings medium back', async () => {
  const odd = await page({ badgeSize: 'huge' });
  assert.equal(chosen(odd.options), 'medium');
  const { storage, options } = await page({ badgeSize: 'large' });
  await options.$('resetSettings').dispatch('click');
  await settle();
  assert.equal(storage.areas.sync.badgeSize, undefined);
  assert.equal(chosen(options), 'medium');
});
