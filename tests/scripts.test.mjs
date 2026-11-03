// Titles in other scripts (db.js, 1.2.2): the key function of the languages
// store, which language(s) a script points at, which rows of the akas file
// the extract keeps, and whether an extract covers a language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const ctx = { console, indexedDB: undefined, setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('db.js', root), 'utf8') + '\nglobalThis.RatingsDB = RatingsDB;', ctx, { filename: 'db.js' });
const R = ctx.RatingsDB;
const N = '\\N'; // the file's empty field

test('Latin titles keep the keys of 1.2.0', () => {
  for (const t of ['Stranger Things', 'Zadzwoń do Saula', 'Car S.O.S.', 'Léon: The Professional', '1987', 'Ms. Marvel']) {
    assert.equal(R.normaliseAny(t), R.normalise(t), t);
  }
});

test('other scripts keep every letter and digit, folded, with no spaces or punctuation', () => {
  assert.equal(R.normaliseAny('오징어 게임'), '오징어게임');
  assert.equal(R.normaliseAny('사랑의 불시착 2'), '사랑의불시착2', 'a digit does not make it a Latin title');
  assert.equal(R.normaliseAny('千と千尋の神隠し'), '千と千尋の神隠し');
  assert.equal(R.normaliseAny('ｽﾄﾚﾝｼﾞｬｰ･ｼﾝｸﾞｽ'), R.normaliseAny('ストレンジャー・シングス'), 'half-width katakana');
  assert.notEqual(R.normaliseAny('が'), R.normaliseAny('か'), 'voicing marks are letters');
  assert.equal(R.normaliseAny('Война и мир'), 'войнаимир');
  assert.equal(R.normaliseAny('ΤΟ ΝΗΣΙ'), 'τονησι');
  assert.equal(R.normaliseAny('שָׁלוֹם'), R.normaliseAny('שלום'), 'Hebrew points');
  assert.equal(R.normaliseAny('مُحَمَّد'), R.normaliseAny('محمد'), 'Arabic harakat');
  assert.equal(R.normaliseAny('Ms. マーベル'), 'msマーベル', 'the Latin part is folded too');
  assert.equal(R.normaliseAny('英雄 (2002)'), '英雄2002');
});

test('scriptLanguages: kana settle Japanese, Han alone may be either, Cyrillic any of its languages', () => {
  assert.deepEqual([...R.scriptLanguages('오징어 게임')], ['ko']);
  assert.deepEqual([...R.scriptLanguages('千と千尋の神隠し')], ['ja']);
  assert.deepEqual([...R.scriptLanguages('英雄')].sort(), ['ja', 'zh']);
  assert.deepEqual([...R.scriptLanguages('Война и мир')].sort(), ['bg', 'ru', 'uk']);
  assert.deepEqual([...R.scriptLanguages('Το νησί')], ['el']);
  assert.deepEqual([...R.scriptLanguages('दंगल')], ['hi']);
  assert.deepEqual([...R.scriptLanguages('הבית')], [], 'Hebrew is not in the table');
  assert.deepEqual([...R.scriptLanguages('Stranger Things')], []);
});

// The fields of a title.akas line.
const row = ({ id = 'tt1', title, region = N, language = N, types = N, attributes = N, original = '0' }) =>
  [id, '1', title, region, language, types, attributes, original];
const langs = new Set(Object.keys(R.LANGUAGES));
const regions = new Set(Object.values(R.LANGUAGES).flat());
const keep = (f) => Array.from(R.extractRow(f, langs, regions), (r) => [...r]);

test('extractRow keeps a known language or region row, nothing else', () => {
  assert.deepEqual(keep(row({ title: 'Zadzwoń do Saula', region: 'PL' })), [['tt1', 'Zadzwoń do Saula', 'PL', N]]);
  assert.deepEqual(keep(row({ title: '기묘한 이야기', region: 'KR' })), [['tt1', '기묘한 이야기', 'KR', N]]);
  assert.deepEqual(keep(row({ title: '怪奇物语', region: 'CN', language: 'cmn' })), [['tt1', '怪奇物语', 'CN', 'cmn']], 'cmn is Chinese');
  assert.deepEqual(keep(row({ title: 'Stranger Things', region: 'US' })), [], 'an unknown region');
  assert.deepEqual(keep(row({ title: 'Stranger Things', region: 'KR', language: 'en' })), [], 'an English title in Korea');
  assert.deepEqual(keep(row({ title: '기묘한 이야기', region: 'KR', types: 'working' })), [], 'a working title');
  assert.deepEqual(keep(row({ title: '기묘한 이야기', region: 'KR', attributes: 'literal title' })), [], 'an attribute');
  assert.deepEqual(keep(row({ title: '기묘한 이야기', region: 'KR', types: 'imdbDisplay' })), [['tt1', '기묘한 이야기', 'KR', N]]);
});

test('extractRow keeps an original title in another script under its language(s), never a Latin one', () => {
  assert.deepEqual(keep(row({ title: '오징어 게임', original: '1' })), [['tt1', '오징어 게임', N, 'ko']]);
  assert.deepEqual(keep(row({ title: '英雄', original: '1' })).map((r) => r[3]).sort(), ['ja', 'zh']);
  assert.deepEqual(keep(row({ title: 'Stranger Things', original: '1' })), [], 'a key already');
  assert.deepEqual(keep(row({ title: 'Léon', original: '1' })), [], 'accents are Latin');
  assert.deepEqual(keep(row({ title: '1987', original: '1' })), [], 'no letters at all');
});

test('keyRowWanted: by language when the row names one, by region otherwise, aliases folded', () => {
  const want = new Set(['zh']);
  const zhRegions = new Set(R.LANGUAGES.zh);
  assert.ok(R.keyRowWanted('CN', 'cmn', want, zhRegions));
  assert.ok(R.keyRowWanted('HK', 'yue', want, zhRegions));
  assert.ok(R.keyRowWanted('TW', N, want, zhRegions));
  assert.ok(!R.keyRowWanted('CN', 'en', want, zhRegions));
  assert.ok(!R.keyRowWanted('JP', N, want, zhRegions));
});

test('akasCovers: no extract covers all; an old extract lacks the new scripts; a new one has them', () => {
  assert.ok(R.akasCovers(null, ['ko']));
  assert.ok(R.akasCovers({ akasAt: 0 }, ['ko']));
  assert.ok(R.akasCovers({ akasAt: 1 }, ['pl', 'de']), 'format 1 by default');
  assert.ok(!R.akasCovers({ akasAt: 1 }, ['pl', 'ko']));
  assert.ok(R.akasCovers({ akasAt: 1, akasFormat: 2 }, ['pl', 'ko', 'zh']));
  assert.equal(R.AKAS_FORMAT, 2);
  for (const l of Object.keys(R.AKAS_NEEDS)) assert.ok(R.LANGUAGES[l], l + ' is in the table');
});

test('the aliases point at table entries and langCode-style tags fold', () => {
  for (const [from, to] of Object.entries(R.LANGUAGE_ALIASES)) {
    assert.ok(R.LANGUAGES[to], from + ' -> ' + to);
    assert.equal(R.LANGUAGES[from], undefined, from);
  }
  assert.equal(R.languageOf('cmn'), 'zh');
  assert.equal(R.languageOf('in'), 'id');
});
