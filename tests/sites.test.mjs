// The sites table (sites-list.js, 1.3.0): that the manifest agrees with
// it, the address checks, the background's registrations for optional
// sites and added addresses, and the settings page's Sites list.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { makeStorage, makeGrants, makeScripting, loadBackground, loadOptions, settle, BACKGROUND_SCRIPTS } from './harness.mjs';

const root = new URL('..', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const S = vm.runInContext(read('sites-list.js') + '\nIMDBEXT_SITES;', vm.createContext({}), { filename: 'sites-list.js' });
const manifest = JSON.parse(read('manifest.json'));

test('the manifest agrees with the table: required sites as content scripts, optional ones as optional hosts', () => {
  for (const name of S.REQUIRED) {
    const cs = manifest.content_scripts.find((c) => c.js[0] === S.adapterFile(name));
    assert.ok(cs, name + ' has a content script');
    assert.deepEqual([...cs.matches].sort(), S.SITES[name].addresses.map(S.patternOf).sort(), name + "'s patterns");
    assert.deepEqual(cs.js, [S.adapterFile(name), 'content.js']);
  }
  assert.equal(manifest.content_scripts.length, S.REQUIRED.length, 'no content script outside the table');
  for (const name of S.OPTIONAL) {
    for (const a of S.SITES[name].addresses) assert.ok(manifest.optional_host_permissions.includes(S.patternOf(a)), name + ': ' + a);
  }
  assert.ok(manifest.optional_host_permissions.includes(S.ANY_SITE), 'the catch-all for added addresses');
  assert.ok(manifest.permissions.includes('scripting'), 'scripting, for the registrations');
  for (const name of S.NAMES) assert.ok(existsSync(new URL(S.adapterFile(name), root)), S.adapterFile(name));
  assert.ok(S.SITES.letterboxd.optional, 'Letterboxd is optional');
});

test('the Firefox manifest lists the optional hosts as host permissions and loads sites-list.js', () => {
  const out = JSON.parse(execFileSync(process.execPath, [new URL('store/firefox-manifest.mjs', root).pathname.replace(/^\/([A-Z]:)/, '$1')], { encoding: 'utf8' }));
  for (const p of manifest.optional_host_permissions) assert.ok(out.host_permissions.includes(p), p);
  assert.equal(out.optional_host_permissions, undefined);
  assert.deepEqual(out.background.scripts, BACKGROUND_SCRIPTS);
  assert.ok(read('background.js').includes("importScripts('compat.js', 'sites-list.js',"), 'Chrome loads it first too');
});

test('normalizeAddress: a host, a host with a path, a pasted link; nothing else', () => {
  assert.equal(S.normalizeAddress('www.amazon.co.uk'), 'www.amazon.co.uk');
  assert.equal(S.normalizeAddress('  https://www.Amazon.co.uk/gp/video/?x=1#y '), 'www.amazon.co.uk/gp/video');
  assert.equal(S.normalizeAddress('https://www.amazon.co.uk/gp/video/storefront'), 'www.amazon.co.uk/gp/video/storefront');
  assert.equal(S.normalizeAddress('tv.apple.com/'), 'tv.apple.com');
  assert.equal(S.normalizeAddress('amazon'), null, 'no dot');
  assert.equal(S.normalizeAddress('*.amazon.com'), null, 'no wildcards');
  assert.equal(S.normalizeAddress('www.amazon.com/../x'), null);
  assert.equal(S.normalizeAddress(''), null);
  assert.equal(S.patternOf('www.amazon.co.uk/gp/video'), 'https://www.amazon.co.uk/gp/video/*');
});

test('addProblem: shipped addresses are refused, wider is allowed, overlaps with added ones refused', () => {
  assert.equal(S.addProblem('primevideo', 'www.amazon.co.uk/gp/video', {}), null);
  assert.equal(S.addProblem('primevideo', 'www.amazon.com', {}), null, 'wider than /gp/video: the purchase pages');
  assert.match(S.addProblem('primevideo', 'www.amazon.com/gp/video', {}), /already part of Prime Video/);
  assert.match(S.addProblem('primevideo', 'www.amazon.com/gp/video/storefront', {}), /already part of Prime Video/);
  assert.match(S.addProblem('primevideo', 'www.netflix.com', {}), /Netflix’s own address/);
  assert.match(S.addProblem('netflix', 'www.netflix.com', {}), /already part of Netflix/);
  const added = { primevideo: ['www.amazon.co.uk/gp/video'] };
  assert.match(S.addProblem('primevideo', 'www.amazon.co.uk/gp/video', added), /already added/);
  assert.match(S.addProblem('primevideo', 'www.amazon.co.uk', added), /overlaps www.amazon.co.uk\/gp\/video/);
  assert.match(S.addProblem('hulu', 'www.amazon.co.uk/gp/video/x', added), /overlaps/, 'under another site too');
  assert.equal(S.addProblem('primevideo', 'www.amazon.de/gp/video', added), null);
  assert.equal(S.guessSite('www.amazon.de/gp/video'), 'primevideo');
  assert.equal(S.guessSite('www.hulu.jp'), 'hulu');
  assert.equal(S.guessSite('example.org'), null);
});

test('the background registers optional sites and added addresses while granted, and drops them when not', async () => {
  const storage = makeStorage({ sync: { addresses: { primevideo: ['www.amazon.co.uk/gp/video', 'www.amazon.com'] } } });
  const grants = makeGrants();
  const scripting = makeScripting();
  const bg = loadBackground({ storage, grants, scripting });
  await settle();
  assert.deepEqual([...scripting.scripts.keys()], [], 'nothing granted, nothing registered');

  grants.set.add('https://letterboxd.com/*');
  grants.set.add('https://www.amazon.co.uk/gp/video/*');
  await bg.message({ type: 'sync-sites' });
  assert.deepEqual([...scripting.scripts.keys()].sort(), ['letterboxd@letterboxd.com', 'primevideo@www.amazon.co.uk/gp/video']);
  const uk = scripting.scripts.get('primevideo@www.amazon.co.uk/gp/video');
  assert.deepEqual(uk.matches, ['https://www.amazon.co.uk/gp/video/*']);
  assert.deepEqual(uk.js, ['sites/primevideo.js', 'content.js']);
  assert.equal(uk.excludeMatches, undefined);
  assert.deepEqual(scripting.scripts.get('letterboxd@letterboxd.com').js, ['sites/letterboxd.js', 'content.js']);

  // The wider address excludes the site's own pages, which the manifest's
  // script already covers.
  grants.set.add('https://www.amazon.com/*');
  await bg.message({ type: 'sync-sites' });
  const wide = scripting.scripts.get('primevideo@www.amazon.com');
  assert.deepEqual(wide.matches, ['https://www.amazon.com/*']);
  assert.deepEqual(wide.excludeMatches, ['https://www.amazon.com/gp/video/*']);

  // A grant withdrawn (Site access on chrome://extensions): the event alone unregisters.
  grants.set.delete('https://letterboxd.com/*');
  bg.listeners.permRemoved?.forEach((fn) => fn());
  await bg.message({ type: 'sync-sites' });
  assert.ok(!scripting.scripts.has('letterboxd@letterboxd.com'));

  // The address removed in the settings: the storage change alone unregisters.
  await storage.sync.set({ addresses: { primevideo: ['www.amazon.com'] } });
  await settle();
  assert.deepEqual([...scripting.scripts.keys()], ['primevideo@www.amazon.com']);
});

// The settings page over the background, with the browser's grants shared.
async function page({ sync = {}, granted = [], allow = true } = {}) {
  const storage = makeStorage({ sync });
  const grants = makeGrants(granted, { allow });
  const scripting = makeScripting();
  const background = loadBackground({ storage, grants, scripting });
  const options = loadOptions({ storage, background, grants });
  await settle();
  return { storage, grants, scripting, background, options };
}

test('the Sites list: ticked rows first in the table order, the new site unticked, an address row under its site', async () => {
  const { options } = await page({ sync: { sites: { hulu: false }, addresses: { primevideo: ['www.amazon.co.uk/gp/video'] } }, granted: ['https://www.amazon.co.uk/gp/video/*'] });
  const rows = options.siteRows();
  assert.deepEqual(rows.map((r) => r.key), ['netflix', 'primevideo', 'hbomax', 'appletv', 'disneyplus', 'paramountplus', 'tubi', 'www.amazon.co.uk/gp/video', 'hulu', 'letterboxd']);
  assert.deepEqual(rows.map((r) => r.checked), [true, true, true, true, true, true, true, true, false, false]);
  assert.equal(rows.find((r) => r.key === 'letterboxd').hint, '(new in 1.3)');
  assert.equal(rows.find((r) => r.key === 'www.amazon.co.uk/gp/video').hint, '(Prime Video)');
});

test('ticking Letterboxd asks for its address, stores the switch and registers; unticking gives the grant back', async () => {
  const { options, storage, grants, scripting } = await page();
  const row = options.siteRows().find((r) => r.key === 'letterboxd');
  row.label.querySelector('input').checked = true;
  await row.label.querySelector('input').dispatch('change');
  await settle();
  assert.deepEqual(grants.asked, [['https://letterboxd.com/*']]);
  assert.equal(storage.areas.sync.sites.letterboxd, true);
  assert.ok(scripting.scripts.has('letterboxd@letterboxd.com'), 'registered');
  assert.match(options.$('status').textContent, /Letterboxd on\. Reload any Letterboxd tab/);

  row.label.querySelector('input').checked = false;
  await row.label.querySelector('input').dispatch('change');
  await settle();
  assert.equal(storage.areas.sync.sites.letterboxd, false);
  assert.ok(!grants.set.has('https://letterboxd.com/*'), 'the grant is given back');
  assert.ok(!scripting.scripts.has('letterboxd@letterboxd.com'));
});

test('a tick stays ticked when an earlier save stored the site as off (the grant event fires before the save)', async () => {
  // Any click on another box saves the whole list, Letterboxd as false;
  // the browser's onAdded for the page's own request then arrives before
  // the tick is saved, and must not untick it from the stored value.
  const { options, storage, grants } = await page({ sync: { sites: { hulu: false, letterboxd: false } } });
  const row = options.siteRows().find((r) => r.key === 'letterboxd');
  row.label.querySelector('input').checked = true;
  await row.label.querySelector('input').dispatch('change');
  await settle();
  assert.equal(row.label.querySelector('input').checked, true);
  assert.equal(storage.areas.sync.sites.letterboxd, true);
  assert.ok(grants.set.has('https://letterboxd.com/*'));
});

test('a refused grant leaves the site off and says so', async () => {
  const { options, storage, grants } = await page({ allow: false });
  const row = options.siteRows().find((r) => r.key === 'letterboxd');
  row.label.querySelector('input').checked = true;
  await row.label.querySelector('input').dispatch('change');
  await settle();
  assert.equal(row.label.querySelector('input').checked, false);
  assert.equal(grants.set.size, 0);
  assert.equal(storage.areas.sync.sites, undefined, 'nothing written');
  assert.match(options.$('status').textContent, /not allowed/);
});

test('adding an address: checked, asked for, stored under its site with its own switch, registered; the cross removes it all', async () => {
  const { options, storage, grants, scripting } = await page();
  const $ = options.$;
  $('siteAddress').value = 'https://www.Amazon.co.uk/gp/video/storefront?x=1';
  await $('siteAddress').dispatch('input');
  assert.equal($('siteAdapter').value, 'primevideo', 'guessed from the host');
  $('siteAddress').value = 'www.amazon.com/gp/video';
  await $('siteAddBtn').dispatch('click');
  assert.match($('status').textContent, /already part of Prime Video/);
  assert.equal(grants.asked.length, 0, 'nothing asked for a refused address');

  $('siteAddress').value = 'https://www.amazon.co.uk/gp/video/';
  await $('siteAddBtn').dispatch('click');
  await settle();
  assert.deepEqual(grants.asked, [['https://www.amazon.co.uk/gp/video/*']]);
  assert.deepEqual(storage.areas.sync.addresses, { primevideo: ['www.amazon.co.uk/gp/video'] });
  assert.equal(storage.areas.sync.sites['www.amazon.co.uk/gp/video'], true);
  assert.equal($('siteAddress').value, '', 'the box is blank again');
  const row = options.siteRows().find((r) => r.key === 'www.amazon.co.uk/gp/video');
  assert.ok(row && row.checked);
  assert.equal(row.hint, '(Prime Video)');
  assert.ok(scripting.scripts.has('primevideo@www.amazon.co.uk/gp/video'));
  assert.match($('status').textContent, /Added www.amazon.co.uk\/gp\/video under Prime Video/);

  // Its own tick keeps the grant.
  row.label.querySelector('input').checked = false;
  await row.label.querySelector('input').dispatch('change');
  await settle();
  assert.equal(storage.areas.sync.sites['www.amazon.co.uk/gp/video'], false);
  assert.ok(grants.set.has('https://www.amazon.co.uk/gp/video/*'));

  await row.label.querySelector('a').dispatch('click');
  await settle();
  assert.deepEqual(storage.areas.sync.addresses, {});
  assert.equal(storage.areas.sync.sites['www.amazon.co.uk/gp/video'], undefined);
  assert.ok(!grants.set.has('https://www.amazon.co.uk/gp/video/*'));
  assert.ok(!scripting.scripts.has('primevideo@www.amazon.co.uk/gp/video'));
  assert.ok(!options.siteRows().some((r) => r.key === 'www.amazon.co.uk/gp/video'));
});

test('an address synced from another device shows unticked as not allowed here; ticking asks', async () => {
  const { options, grants, storage } = await page({ sync: { addresses: { primevideo: ['www.amazon.de/gp/video'] }, sites: { 'www.amazon.de/gp/video': true } } });
  const row = options.siteRows().find((r) => r.key === 'www.amazon.de/gp/video');
  assert.equal(row.checked, false);
  assert.equal(row.hint, '(Prime Video, not allowed here)');
  row.label.querySelector('input').checked = true;
  await row.label.querySelector('input').dispatch('change');
  await settle();
  assert.deepEqual(grants.asked, [['https://www.amazon.de/gp/video/*']]);
  assert.equal(options.siteRows().find((r) => r.key === 'www.amazon.de/gp/video').hint, '(Prime Video)');
  assert.equal(storage.areas.sync.sites['www.amazon.de/gp/video'], true);
});

test('Reset settings drops the addresses and gives back the optional grants', async () => {
  const { options, grants, storage, scripting } = await page({ sync: { addresses: { primevideo: ['www.amazon.de/gp/video'] }, sites: { letterboxd: true } }, granted: ['https://letterboxd.com/*', 'https://www.amazon.de/gp/video/*'] });
  await options.$('resetSettings').dispatch('click');
  await settle();
  assert.equal(storage.areas.sync.addresses, undefined);
  assert.equal(storage.areas.sync.sites, undefined);
  assert.equal(grants.set.size, 0);
  assert.deepEqual([...scripting.scripts.keys()], []);
  assert.deepEqual(options.siteRows().map((r) => r.key).slice(-1), ['letterboxd']);
  assert.equal(options.siteRows().find((r) => r.key === 'letterboxd').checked, false);
});
