// The Netflix adapter's English-name fallback (sites/netflix.js): a card
// named in another script reads the title's public page once, signed out,
// and from then on its English name is tried first. Run with a stubbed
// fetch, storage and DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);

function sandbox(pages) {
  const fetches = [];
  const rescans = { count: 0 };
  const stored = {};
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Error, Date, RegExp, Set, Map, JSON, Object, Array, Number, String,
    ReadableStream, TextDecoderStream, TextEncoder, AbortController, Event: class Event { constructor(type) { this.type = type; } },
    DOMParser: class { parseFromString(html) { return { body: { textContent: html.replace(/<[^>]+>/g, '') } }; } },
    location: { origin: 'https://www.netflix.com', search: '', pathname: '/browse', href: 'https://www.netflix.com/browse' },
    document: {
      addEventListener() {},
      dispatchEvent(e) { if (e.type === 'imdbext-rescan') rescans.count++; return true; },
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    chrome: { storage: { local: { get: async () => ({}), set: async (o) => Object.assign(stored, o) } } },
    fetch: async (url, opts) => {
      fetches.push({ url, credentials: opts && opts.credentials });
      const id = (url.match(/\/title\/(\d+)/) || [])[1];
      const page = pages[id];
      if (!page) return { ok: false, url, body: new ReadableStream({ start(c) { c.close(); } }) };
      const html = '<html><body>' + 'x'.repeat(500) + '<h1 class="title">' + page.h1 + '</h1>' + 'y'.repeat(500) + '</body></html>';
      return {
        ok: true,
        url: 'https://www.netflix.com/title/' + (page.redirect || id),
        body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(html)); c.close(); } }),
      };
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('sites/netflix.js', root), 'utf8'), ctx, { filename: 'sites/netflix.js' });
  const site = ctx.window.IMDBEXT_SITE;
  return { site, fetches, rescans, stored, card: site.targets[0] };
}

const card = (label, id) => ({
  getAttribute: (k) => (k === 'aria-label' ? label : k === 'href' ? '/browse?jbv=' + id : null),
  closest: () => null,
  querySelector: () => null,
});
const settle = () => new Promise((r) => setTimeout(r, 30));

test('a Latin name is used as it is and reads no page', async () => {
  const s = sandbox({});
  await settle();
  assert.equal(s.card.titleOf(card('Ozark', '80117552')), 'Ozark');
  await settle();
  assert.equal(s.fetches.length, 0);
});

test('a name in another script reads the public page once, then its English name goes first', async () => {
  const s = sandbox({ 70143836: { h1: 'Breaking Bad' } });
  await settle();
  const el = card('브레이킹 배드', '70143836');
  assert.equal(s.card.titleOf(el), '브레이킹 배드', 'the name alone while the page is unread');
  assert.equal(s.card.titleOf(el), '브레이킹 배드', 'asked twice, read once');
  await settle();
  assert.equal(s.fetches.length, 1);
  assert.equal(s.fetches[0].url, 'https://www.netflix.com/title/70143836');
  assert.equal(s.fetches[0].credentials, 'omit', 'signed out');
  assert.equal(s.rescans.count >= 1, true, 'a rescan once the name is known');
  assert.deepEqual([...s.card.titleOf(el)], ['Breaking Bad', '브레이킹 배드']);
  await settle();
  assert.equal(s.fetches.length, 1, 'no second read');
});

test('a page that itself comes in another script gives no English name, and is not asked again', async () => {
  const s = sandbox({ 1: { h1: '브레이킹 배드' } });
  await settle();
  const el = card('브레이킹 배드', '1');
  s.card.titleOf(el);
  await settle();
  assert.equal(s.fetches.length, 1);
  assert.equal(s.card.titleOf(el), '브레이킹 배드');
  await settle();
  assert.equal(s.fetches.length, 1);
});

test('a missing page is retried only after a while', async () => {
  const s = sandbox({});
  await settle();
  const el = card('오자크', '2');
  s.card.titleOf(el);
  await settle();
  assert.equal(s.fetches.length, 1);
  assert.equal(s.card.titleOf(el), '오자크');
  await settle();
  assert.equal(s.fetches.length, 1, 'failed: not asked again at once');
});

test('the English name is kept in storage.local nfEnglish', async () => {
  const s = sandbox({ 3: { h1: 'Squid Game' } });
  await settle();
  s.card.titleOf(card('오징어 게임', '3'));
  await new Promise((r) => setTimeout(r, 2300)); // nfSave waits two seconds
  assert.equal(s.stored.nfEnglish && s.stored.nfEnglish['3'], 'Squid Game');
});
