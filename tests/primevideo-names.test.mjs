// The Prime Video adapter on amazon.com's shop pages (1.3): what a product
// name becomes as a title, and whether it is read as a series.
import { test } from 'node:test';
import assert from 'node:assert'; // not strict: the adapter's arrays come from another realm
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const ctx = vm.createContext({ window: {}, console });
vm.runInContext(readFileSync(new URL('sites/primevideo.js', root), 'utf8'), ctx, { filename: 'primevideo.js' });
const site = ctx.window.IMDBEXT_SITE;
const search = site.targets.find((t) => t.selector.includes('s-search-result'));

// A result card as the target reads it: a heading, or an image's alt.
function card(name, { heading = true, alt = null } = {}) {
  return {
    tagName: 'DIV',
    dataset: {},
    textContent: name,
    querySelector: (sel) => (sel === 'h2' && heading ? { textContent: name } : sel === 'img[alt]' && alt ? { alt } : null),
    querySelectorAll: () => [],
  };
}
const title = (name, opts) => search.titleOf(card(name, opts));
const type = (name) => search.typeOf(card(name));

test('disc names: format tags, bracketed years, marketing tags and open tails come off', () => {
  assert.equal(title('The Goonies [DVD]'), 'The Goonies');
  assert.equal(title('Top Gun: Maverick (4K UHD + Blu-ray + Digital)'), 'Top Gun: Maverick');
  assert.equal(title('Dune (2021) [Blu-ray] [2021]'), 'Dune (2021)', 'the year in round brackets stays for the lookup');
  assert.equal(title('Wizard of Oz (Repackage) (4K Ultra HD)'), 'Wizard of Oz');
  assert.equal(title('Tenet 4K UHD + Blu-ray – Christopher Nolan Sci-Fi Action Thriller – 2-Disc Region Free'), 'Tenet');
  assert.equal(title('The Fall Guy (2024) - Extended Cut 4K Ultra HD + Blu-ray + Digital'), 'The Fall Guy (2024) - Extended Cut');
  assert.equal(title('Goonies, The (4K Ultra HD + Blu-ray)'), 'The Goonies');
  assert.equal(title('The Office: The Complete Series [DVD]'), 'The Office');
});

test('a boxed set tries the part before its colon too', () => {
  assert.deepEqual(title('Doctor Who: The Matt Smith Collection (DVD)'), ['Doctor Who: The Matt Smith Collection', 'Doctor Who']);
});

test('a card without a format or credits is not a film or show', () => {
  assert.equal(title('The Fighter'), null, 'a paperback');
});

test("a sponsored image's alt loses its prefix", () => {
  assert.equal(title('', { heading: false, alt: 'Sponsored Ad - Constantine (4K Ultra + Digital)' }), 'Constantine');
});

test('a season or complete run makes a series; a film named with Season does not', () => {
  assert.equal(type('Yellowstone - Season 1 [DVD]'), 'series');
  assert.equal(type('Task: The Complete First Season (Blu-ray)'), 'series');
  assert.equal(type('The Office: The Complete Series [DVD]'), 'series');
  assert.equal(type('Season of the Witch [Blu-ray]'), null);
  assert.equal(type('The Last Episode (DVD)'), null);
  assert.equal(type('Oppenheimer [Blu-ray]'), null);
});
