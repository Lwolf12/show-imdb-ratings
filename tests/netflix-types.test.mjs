// Film or series for a Netflix card (sites/netflix.js typeOf / typeLater):
// a name shared by a well-known film and series (db.js ambiguousName) gets
// the card's type from Netflix's public title page, read once, and the
// card is asked again with it. Run with a stubbed fetch, storage and DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DB } from './harness.mjs';

const root = new URL('..', import.meta.url);

// entry = [imdbID, type, startYear, rating, votes, primaryTitle], most-voted first
test('a name with a well-known film and series is ambiguous', () => {
  const hannibal = [
    ['tt0212985', 'm', 2001, 6.8, 300000, 'Hannibal'],
    ['tt2243973', 's', 2013, 8.5, 280000, 'Hannibal'],
  ];
  assert.equal(DB.ambiguousName(hannibal), true);
});

test('a little-seen film beside a popular series is not ambiguous', () => {
  const dark = [
    ['tt5753856', 's', 2017, 8.7, 470000, 'Dark'],
    ['tt0000001', 'm', 2005, 5.1, 900, 'Dark'],
  ];
  assert.equal(DB.ambiguousName(dark), false);
});

test('a name with only films or only series is not ambiguous', () => {
  assert.equal(DB.ambiguousName([['tt1', 'm', 2000, 7, 5000, 'X'], ['tt2', 'm', 1990, 6, 4000, 'X']]), false);
  assert.equal(DB.ambiguousName([['tt3', 's', 2010, 8, 9000, 'Y']]), false);
});

function sandbox(pages) {
  const fetches = [];
  const stored = {};
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Error, Date, RegExp, Set, Map, JSON, Object, Array, Number, String,
    ReadableStream, TextDecoderStream, TextEncoder, AbortController, Event: class Event { constructor(type) { this.type = type; } },
    DOMParser: class { parseFromString(html) { return { body: { textContent: html.replace(/<[^>]+>/g, '') } }; } },
    location: { origin: 'https://www.netflix.com', search: '', pathname: '/browse', href: 'https://www.netflix.com/browse' },
    document: { addEventListener() {}, dispatchEvent: () => true, querySelector: () => null, querySelectorAll: () => [] },
    chrome: { storage: { local: { get: async () => ({}), set: async (o) => Object.assign(stored, o) } } },
    fetch: async (url) => {
      fetches.push(url);
      const id = (url.match(/\/title\/(\d+)/) || [])[1];
      const page = pages[id];
      if (!page) return { ok: false, url, body: new ReadableStream({ start(c) { c.close(); } }) };
      const ld = page.type ? '<script type="application/ld+json">{"@context":"https://schema.org","@type":"' + page.type + '","name":"' + page.h1 + '"}</script>' : '';
      const html = '<html><head>' + ld + '</head><body>' + 'x'.repeat(500) + '<h1>' + page.h1 + '</h1></body></html>';
      return {
        ok: true,
        url: 'https://www.netflix.com/title/' + id,
        body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(html)); c.close(); } }),
      };
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('sites/netflix.js', root), 'utf8'), ctx, { filename: 'sites/netflix.js' });
  return { card: ctx.window.IMDBEXT_SITE.targets[0], fetches, stored };
}

const card = (label, id) => ({
  getAttribute: (k) => (k === 'aria-label' ? label : k === 'href' ? '/browse?jbv=' + id : null),
  closest: () => null,
  querySelector: () => null,
});
const settle = () => new Promise((r) => setTimeout(r, 2100)); // past nfSave's 2 s

test('a card has no type until asked, then its page says series, read once', async () => {
  const s = sandbox({ 70258489: { h1: 'Hannibal', type: 'TVSeries' } });
  const el = card('Hannibal', '70258489');
  assert.equal(s.card.typeOf(el), null);
  assert.equal(s.fetches.length, 0);
  assert.equal(await s.card.typeLater(el), 'series');
  assert.equal(s.card.typeOf(el), 'series');
  assert.equal(await s.card.typeLater(el), 'series');
  assert.equal(s.fetches.length, 1);
  await settle();
  assert.equal(s.stored.nfTypes['70258489'], 'series');
});

test('a film page says movie', async () => {
  const s = sandbox({ 60020435: { h1: 'Hannibal', type: 'Movie' } });
  assert.equal(await s.card.typeLater(card('Hannibal', '60020435')), 'movie');
});

test('two cards asking at once share one read', async () => {
  const s = sandbox({ 70258489: { h1: 'Hannibal', type: 'TVSeries' } });
  const el = card('Hannibal', '70258489');
  const [a, b] = await Promise.all([s.card.typeLater(el), s.card.typeLater(el)]);
  assert.equal(a, 'series');
  assert.equal(b, 'series');
  assert.equal(s.fetches.length, 1);
});

test('no page, or a page without a type, gives null and is not retried at once', async () => {
  const s = sandbox({ 2: { h1: 'Something' } });
  assert.equal(await s.card.typeLater(card('Nothing', '1')), null);
  assert.equal(await s.card.typeLater(card('Nothing', '1')), null);
  assert.equal(await s.card.typeLater(card('Something', '2')), null);
  assert.equal(s.fetches.length, 2);
});

test('a type asked while the English-name read of the same page runs waits for it: one fetch', async () => {
  const s = sandbox({ 70258489: { h1: 'Hannibal', type: 'TVSeries' } });
  const el = card('한니발', '70258489');
  s.card.titleOf(el); // a name in another script: the English-name read starts
  const type = await s.card.typeLater(el);
  assert.equal(type, 'series');
  assert.equal(s.fetches.length, 1);
});
