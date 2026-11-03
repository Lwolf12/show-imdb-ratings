// The language table (db.js): one entry per language, aliases for the tags
// browsers send, and the row rule the builder applies (a row's own
// language first, its region only without one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const ctx = { console, indexedDB: undefined, setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('db.js', root), 'utf8') + '\nglobalThis.RatingsDB = RatingsDB;', ctx, { filename: 'db.js' });
const { LANGUAGES, LANGUAGE_ALIASES, languageOf } = ctx.RatingsDB;

test('each language once: no nb beside no, and the aliases point at listed languages', () => {
  assert.equal(LANGUAGES.nb, undefined);
  assert.deepEqual([...LANGUAGES.no], ['NO']);
  assert.equal(LANGUAGE_ALIASES.nb, 'no');
  assert.equal(LANGUAGE_ALIASES.nn, 'no');
  for (const to of Object.values(LANGUAGE_ALIASES)) assert.ok(LANGUAGES[to], to);
  for (const from of Object.keys(LANGUAGE_ALIASES)) assert.equal(LANGUAGES[from], undefined, from + ' is an alias, not an entry');
  assert.equal(languageOf('nb'), 'no');
  assert.equal(languageOf('nn'), 'no');
  assert.equal(languageOf('pl'), 'pl');
});

test('Catalan has no region: ES rows are Spanish', () => {
  assert.deepEqual([...LANGUAGES.ca], []);
  assert.ok(LANGUAGES.es.includes('ES'));
});

test('the row rule keeps a Catalan row in ES for Catalan only, and a region row for its region', () => {
  // keyFromExtract's test, with the sets it builds for the chosen languages.
  const place = (langs, region, language) => {
    const want = new Set(langs);
    const regions = new Set(langs.flatMap((l) => LANGUAGES[l] || []));
    return language !== '\\N' ? want.has(languageOf(language)) : regions.has(region);
  };
  assert.ok(place(['ca'], 'ES', 'ca'));
  assert.ok(!place(['es'], 'ES', 'ca'));
  assert.ok(place(['es'], 'ES', '\\N'));
  assert.ok(!place(['fr'], 'CA', 'en'), 'an English title in Canada is not French');
  assert.ok(place(['fr'], 'CA', '\\N'));
  assert.ok(place(['no'], 'NO', 'nb'), 'IMDb may write Bokmål');
});
