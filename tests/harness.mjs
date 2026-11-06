// Runs the extension's background scripts and settings page in node: one
// vm context each, sharing a chrome.storage stand-in whose writes fire
// onChanged in both, with the settings page's sendMessage going to the
// background's message listener. The database is a stub around a meta
// record (no IndexedDB); the settings page gets a small fake DOM. Enough
// to drive the settings page's handlers and watch what the background
// does with the writes.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');

// The load order of the background scripts, as store/firefox-manifest.mjs
// lists them and background.js imports them.
export const BACKGROUND_SCRIPTS = ['compat.js', 'sites-list.js', 'db.js', 'omdb.js', 'lookup.js', 'languages.js', 'refresh.js', 'build.js', 'background.js'];
export const OPTIONS_SCRIPTS = ['compat.js', 'sites-list.js', 'options-text.js', 'options-languages.js', 'options.js'];

// chrome.storage fires onChanged after the write, not during it.
export const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

export function makeStorage(init = {}) {
  const areas = { sync: { ...(init.sync || {}) }, local: { ...(init.local || {}) }, session: { ...(init.session || {}) } };
  const listeners = [];
  const fire = (changes, name) => {
    if (!Object.keys(changes).length) return;
    for (const fn of listeners) setTimeout(() => fn(changes, name), 0);
  };
  const area = (name) => ({
    async get(keys) {
      const data = areas[name];
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out = typeof keys === 'object' && !Array.isArray(keys) ? { ...keys } : {};
      for (const k of list) if (k in data) out[k] = data[k];
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: areas[name][k], newValue: v };
        areas[name][k] = v;
      }
      fire(changes, name);
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) {
        if (!(k in areas[name])) continue;
        changes[k] = { oldValue: areas[name][k] };
        delete areas[name][k];
      }
      fire(changes, name);
    },
  });
  return { areas, sync: area('sync'), local: area('local'), session: area('session'), onChanged: { addListener: (fn) => listeners.push(fn) } };
}

// The browser's host permission grants, as both contexts see them: a set
// of match patterns; request() grants when allow is true. onAdded and
// onRemoved fire in every context that listens (after the call, like the
// browser).
export function makeGrants(initial = [], { allow = true } = {}) {
  const set = new Set(initial);
  const added = [];
  const removed = [];
  const fire = (list) => { for (const fn of list) setTimeout(fn, 0); };
  const has = (origins) => (origins || []).every((o) => set.has(o));
  const grants = {
    set, allow, asked: [],
    api: () => ({
      contains: async ({ origins }) => has(origins),
      request: async ({ origins }) => {
        grants.asked.push(origins);
        if (!grants.allow) return false;
        for (const o of origins) set.add(o);
        fire(added);
        return true;
      },
      remove: async ({ origins }) => {
        for (const o of origins) set.delete(o);
        fire(removed);
        return true;
      },
      onAdded: { addListener: (fn) => added.push(fn) },
      onRemoved: { addListener: (fn) => removed.push(fn) },
    }),
  };
  return grants;
}

// chrome.scripting as the background uses it: the registered scripts by id.
export function makeScripting() {
  const scripts = new Map();
  return {
    scripts,
    api: {
      getRegisteredContentScripts: async () => [...scripts.values()],
      registerContentScripts: async (list) => { for (const s of list) { if (scripts.has(s.id)) throw new Error('registered twice: ' + s.id); scripts.set(s.id, s); } },
      unregisterContentScripts: async ({ ids }) => { for (const id of ids) scripts.delete(id); },
    },
  };
}

const events = () => {
  const listeners = {};
  const ev = (name) => ({ addListener(fn) { (listeners[name] ||= []).push(fn); } });
  return { listeners, ev };
};

// db.js on its own, for its constants (FORMAT, AKAS_FORMAT).
export const DB = vm.runInContext(read('db.js') + '\nRatingsDB;', vm.createContext({ console }), { filename: 'db.js' });

// What db.js status() says for a meta record (kept in step with it).
export function statusOf(m) {
  const FORMAT = DB.FORMAT;
  return m
    ? {
        present: true, built: m.built, builtAt: m.builtAt, ratingsBuilt: m.ratingsBuilt || m.built, ratingsAt: m.ratingsAt || m.builtAt,
        minVotes: m.minVotes, titles: m.titles, episodes: m.episodes, episodesPending: !!m.episodesPending, unknown: m.unknown || 0,
        outdated: (m.format || 1) < FORMAT, langs: m.langs || [], akasAt: m.akasAt || 0, akasSize: m.akasSize || 0,
        akasFormat: m.akasAt ? m.akasFormat || 1 : 0, akas: m.akas || 0,
      }
    : { present: false };
}

// A built database's meta record, as builder.js writes it, with overrides.
export function builtMeta(over = {}) {
  const day = 24 * 60 * 60 * 1000;
  return { format: DB.FORMAT, built: '2026-11-01', builtAt: Date.now() - 3 * day, titles: 420000, episodes: 7000000, minVotes: 25, unknown: 0, langs: [], ...over };
}

export function loadBackground({ storage, meta = null, file = null, languages = ['en-US'], grants = null, scripting = null } = {}) {
  const { listeners, ev } = events();
  const sent = []; // runtime.sendMessage calls (to the build page)
  const db = { meta, file, log: [] };
  const chrome = {
    storage: { sync: storage.sync, local: storage.local, session: storage.session, onChanged: storage.onChanged },
    runtime: {
      onInstalled: ev('installed'), onStartup: ev('startup'), onMessage: ev('message'),
      getManifest: () => ({ version: '0.0.0', content_scripts: [] }),
      getURL: (p) => 'chrome-extension://test/' + p,
      sendMessage: async (m) => { sent.push(m); if (m && m.target === 'offscreen') return; throw new Error('no receiver'); },
      openOptionsPage: async () => {},
    },
    action: { onClicked: ev('clicked'), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {}, setTitle: async () => {} },
    alarms: { create: () => {}, onAlarm: ev('alarm') },
    permissions: grants ? grants.api() : { contains: async () => true, onAdded: ev('permAdded'), onRemoved: ev('permRemoved') },
    ...(scripting ? { scripting: scripting.api } : {}),
    windows: { create: async () => ({ id: 1 }), update: async () => {} },
    offscreen: { hasDocument: async () => false, createDocument: async () => {}, closeDocument: async () => {} },
  };
  const ctx = vm.createContext({ chrome, console, setTimeout, clearTimeout, URL, navigator: { languages }, fetch: async () => { throw new Error('offline'); } });
  for (const f of BACKGROUND_SCRIPTS) vm.runInContext(read(f), ctx, { filename: f });
  const RatingsDB = vm.runInContext('RatingsDB', ctx);
  Object.assign(RatingsDB, {
    status: async () => statusOf(db.meta),
    getMeta: async () => db.meta,
    getFile: async () => db.file,
    lookup: async () => null,
    lookupById: async () => null,
    lookupEpisodes: async () => null,
    clear: async () => { db.log.push('clear'); db.meta = null; },
    clearAkas: async () => { db.log.push('clearAkas'); if (db.meta) Object.assign(db.meta, { langs: [], akas: 0 }); },
  });
  const message = (msg) => new Promise((res) => {
    const keep = listeners.message[0](msg, {}, res);
    if (!keep) res(undefined);
  });
  // The build page's answer to a start: done at once, the meta updated as
  // the builder would for that kind (tests set what they need in `onBuild`).
  const builds = [];
  const finishBuild = async (info = {}) => {
    const start = sent.filter((m) => m.target === 'offscreen' && m.type === 'build').pop();
    if (!start) throw new Error('no build was started');
    builds.push(start);
    if (start.kind === 'akas' && db.meta) Object.assign(db.meta, { langs: start.langs, akasAt: Date.now(), akasFormat: DB.AKAS_FORMAT, akasSize: 50e6, akas: 1000 });
    const bg = listeners.message[0];
    bg({ target: 'background', type: 'done', kind: start.kind, info: { langs: start.langs, akas: 1000, ...info } }, {}, () => {});
    await settle();
  };
  return { ctx, chrome, listeners, sent, builds, db, message, finishBuild, call: (expr) => vm.runInContext(expr, ctx) };
}

// A fake DOM for the settings page: elements by id, made on demand, with
// what options.js touches (text, flags, classes, data-*, children,
// listeners) and querySelector(All) for the handful of selectors it uses.
function makeDocument() {
  const byId = new Map();
  const classes = (e) => new Set(e.className.split(/\s+/).filter(Boolean));
  const matches = (e, sel) => {
    const m = sel.match(/^(\w+)?(\.[\w-]+)?(:checked)?$/);
    if (!m) throw new Error('selector not understood: ' + sel);
    const [, tag, cls, checked] = m;
    return (!tag || e.tag === tag) && (!cls || classes(e).has(cls.slice(1))) && (!checked || e.checked === true);
  };
  const descendants = (e) => e.children.flatMap((c) => [c, ...descendants(c)]);
  function el(tag = 'div') {
    const e = {
      tag, id: '', textContent: '', className: '', hidden: false, disabled: false, title: '', checked: false, value: '', dataset: {},
      children: [], childNodes: [], listeners: {}, parentElement: null,
      classList: {
        add(c) { const s = classes(e); s.add(c); e.className = [...s].join(' '); },
        remove(c) { const s = classes(e); s.delete(c); e.className = [...s].join(' '); },
        toggle(c, on) { const s = classes(e); const want = on === undefined ? !s.has(c) : !!on; want ? s.add(c) : s.delete(c); e.className = [...s].join(' '); return want; },
        contains(c) { return classes(e).has(c); },
      },
      addEventListener(type, fn) { (e.listeners[type] ||= []).push(fn); },
      async dispatch(type) { for (const fn of e.listeners[type] || []) await fn({ preventDefault() {}, key: '' }); },
      appendChild(c) {
        if (c.parentElement) {
          const p = c.parentElement;
          p.children = p.children.filter((x) => x !== c);
          p.childNodes = p.childNodes.filter((x) => x !== c);
        }
        c.parentElement = e;
        e.childNodes.push(c);
        if (c.tag) e.children.push(c);
        return c;
      },
      querySelectorAll(sel) { return descendants(e).filter((d) => matches(d, sel)); },
      querySelector(sel) { return e.querySelectorAll(sel)[0] || null; },
      replaceChildren() { for (const c of e.children) c.parentElement = null; e.children = []; e.childNodes = []; },
      focus() {}, select() {}, scrollIntoView() {},
    };
    return e;
  }
  // Radio groups the page reads with querySelectorAll('input[name=…]').
  const RADIOS = { badgeSize: ['small', 'medium', 'large'] };
  const radios = {};
  const documentElement = el('html');
  const document = {
    documentElement,
    getElementById(id) {
      if (!byId.has(id)) {
        const e = el(id === 'langList' || id === 'siteList' ? 'div' : id === 'siteAdapter' ? 'select' : id === 'siteAddBtn' ? 'button' : 'input');
        e.id = id;
        e.parentElement = el('label');
        byId.set(id, e);
      }
      return byId.get(id);
    },
    querySelectorAll(sel) {
      const m = sel.match(/^input\[name=(\w+)\]$/);
      if (m && RADIOS[m[1]]) {
        radios[m[1]] ||= RADIOS[m[1]].map((v) => { const e = el('input'); e.value = v; e.name = m[1]; return e; });
        return radios[m[1]];
      }
      return []; // the site, mode, label and extras boxes: none in the fake page
    },
    createElement: (tag) => el(tag),
    createTextNode: (text) => ({ textContent: text }),
  };
  return document;
}

// firefox: the page runs as in Firefox (compat.js FIREFOX).
export function loadOptions({ storage, background, version = '0.0.0', grants = null, firefox = false }) {
  const document = makeDocument();
  const chrome = {
    storage: { sync: storage.sync, local: storage.local, session: storage.session, onChanged: storage.onChanged },
    runtime: { sendMessage: (m) => background.message(m), getManifest: () => ({ version, content_scripts: [] }) },
    tabs: { getCurrent: (cb) => cb(null) },
    permissions: grants ? grants.api() : { contains: async () => true, request: async () => true, remove: async () => {} },
  };
  const ctx = vm.createContext({
    chrome, document, console, setTimeout, clearTimeout, confirm: () => true,
    navigator: { storage: { estimate: async () => ({ usage: 300 * 1048576 }) } },
    ...(firefox ? { browser: { runtime: { getBrowserInfo: async () => ({ name: 'Firefox' }) }, permissions: chrome.permissions } } : {}),
  });
  for (const f of OPTIONS_SCRIPTS) vm.runInContext(read(f), ctx, { filename: f });
  const $ = (id) => document.getElementById(id);
  // The language list's row for a code, once renderLanguages has built it.
  const langRow = (code) => $('langList').querySelectorAll('input').find((i) => i.value === code) || null;
  const ticked = () => $('langList').querySelectorAll('input:checked').map((i) => i.value);
  // The Sites list's rows: [{key, checked, hint}] in list order.
  const siteRows = () => $('siteList').children.map((label) => ({ key: label.querySelector('input').dataset.key, checked: label.querySelector('input').checked, hint: label.querySelector('span').textContent, label }));
  return { ctx, document, $, langRow, ticked, siteRows, call: (expr) => vm.runInContext(expr, ctx) };
}
