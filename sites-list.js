// The sites the extension knows, shared by the background worker (which
// registers a content script for every optional address the browser
// grants), the settings page (the Sites list and its add row) and the
// tests. Chrome's service worker loads it with importScripts, Firefox lists
// it in the manifest before background.js, options.html has a script tag
// for it, and tests load it in a vm context.
//
// Each site is keyed by its adapter's name (sites/<name>.js) and has a
// label and its addresses: a host, optionally followed by a path
// ("www.amazon.com/gp/video"); the content script runs under that path
// only, never on the rest of the host.
//
// Two kinds of site. The eight from 1.2 are required: their content
// scripts are in the manifest with these same addresses as match patterns
// (tests/sites.test.mjs checks they agree), and those patterns never
// change, since widening a required permission makes Chrome switch the
// extension off for everyone until they accept it. Every site added since
// is optional: its patterns sit under optional_host_permissions, the
// browser asks for them only when the user ticks the site, and the
// background registers its content script while access is granted.
//
// The user can also add an address of their own under any site, for a
// country store (www.amazon.co.uk/gp/video) or a site that moved: the
// catch-all ANY_SITE under optional_host_permissions lets the browser be
// asked for exactly that address, which is stored in sync storage as
// addresses[name] and registered like an optional site's. Its tick in the
// Sites list is its own (content.js: sites[address]).

const IMDBEXT_SITES = (() => {
  // In the order the settings list shows them (among sites in the same
  // state), the required eight first.
  const SITES = {
    netflix: { label: 'Netflix', addresses: ['www.netflix.com'] },
    primevideo: { label: 'Prime Video', addresses: ['www.amazon.com/gp/video', 'www.primevideo.com'] },
    hulu: { label: 'Hulu', addresses: ['www.hulu.com'] },
    // HBO Max moved its web app from play.hbomax.com to www.hbomax.com in
    // November 2026; the old address stays while it still serves pages.
    hbomax: { label: 'HBO Max', addresses: ['www.hbomax.com', 'play.hbomax.com'] },
    appletv: { label: 'Apple TV', addresses: ['tv.apple.com'] },
    disneyplus: { label: 'Disney+', addresses: ['www.disneyplus.com'] },
    paramountplus: { label: 'Paramount+', addresses: ['www.paramountplus.com'] },
    tubi: { label: 'Tubi', addresses: ['tubitv.com'] },
    // Optional since 1.3.0: ticked by the user, never on by itself.
    letterboxd: { label: 'Letterboxd', addresses: ['letterboxd.com'], optional: true, note: 'new in 1.3' },
  };
  const NAMES = Object.keys(SITES);
  const REQUIRED = NAMES.filter((n) => !SITES[n].optional);
  const OPTIONAL = NAMES.filter((n) => SITES[n].optional);
  // The optional pattern that lets the user add any address; requested
  // only as the exact address the user typed, never as a whole.
  const ANY_SITE = 'https://*/*';
  const adapterFile = (name) => 'sites/' + name + '.js';

  // A hostname: labels of letters, digits and hyphens, at least one dot, a
  // TLD of letters. No wildcards: an address is one host.
  const HOST = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
  const SEGMENT = /^[A-Za-z0-9._~!$&'()+,;=:@%-]+$/;

  // What the user typed, as an address, or null when it is not one:
  //   "https://www.Amazon.co.uk/gp/video/?x#y"  ->  "www.amazon.co.uk/gp/video"
  //   "tv.apple.com"                            ->  "tv.apple.com"
  //   "amazon"                                  ->  null
  function normalizeAddress(text) {
    let s = String(text || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/^\/\//, '');
    s = s.replace(/[?#].*$/, '');
    const slash = s.indexOf('/');
    const host = (slash < 0 ? s : s.slice(0, slash)).toLowerCase().replace(/\.$/, '');
    if (!HOST.test(host)) return null;
    const path = (slash < 0 ? '' : s.slice(slash + 1)).replace(/\/*\**$/, '');
    if (!path) return host;
    const segments = path.split('/');
    if (segments.some((seg) => !SEGMENT.test(seg) || seg === '.' || seg === '..')) return null;
    return host + '/' + segments.join('/');
  }

  // The match pattern for an address: the host and everything under its
  // path. "www.amazon.com/gp/video" -> "https://www.amazon.com/gp/video/*".
  const patternOf = (address) => 'https://' + address + '/*';
  const hostOf = (address) => address.split('/')[0];
  const pathOf = (address) => (address.includes('/') ? address.slice(address.indexOf('/')) : '');
  // The id of the registered content script for one address of a site.
  const scriptId = (name, address) => name + '@' + address;

  // Whether address a covers address b: the same host, and a's path is
  // b's or above it ("www.amazon.com" covers "www.amazon.com/gp/video").
  function covers(a, b) {
    if (hostOf(a) !== hostOf(b)) return false;
    const p = pathOf(a);
    return !p || pathOf(b) === p || pathOf(b).startsWith(p + '/');
  }
  // Whether two addresses share any page.
  const overlap = (a, b) => covers(a, b) || covers(b, a);

  // The addresses the user added (the "addresses" object in sync storage,
  // name -> [address]) for a site, without any the site has itself.
  function addedTo(name, added) {
    const own = SITES[name] ? SITES[name].addresses : [];
    return (added && Array.isArray(added[name]) ? added[name] : []).filter((a) => !own.some((o) => covers(o, a)));
  }

  // Why an address cannot be added under a site, or null when it can:
  // it is a shipped address of some site, or under one, or overlaps one
  // the user already added. Wider than a site's own address is allowed
  // (www.amazon.com for the purchase pages outside /gp/video); the
  // registration then excludes the site's own patterns.
  function addProblem(name, address, added) {
    for (const n of NAMES) {
      for (const own of SITES[n].addresses) {
        if (covers(own, address)) return n === name ? 'already part of ' + SITES[n].label : 'that is ' + SITES[n].label + '’s own address';
        if (n !== name && covers(address, own)) return 'that would cover ' + SITES[n].label + '’s own address, ' + own;
      }
    }
    for (const n of NAMES) {
      for (const a of addedTo(n, added)) {
        if (overlap(a, address)) return a === address ? 'already added' : 'overlaps ' + a + ', which is already added';
      }
    }
    return null;
  }

  // The site whose name appears in a host, for pre-selecting the adapter:
  // an amazon address is Prime Video.
  function guessSite(address) {
    const host = hostOf(address || '');
    if (/amazon|primevideo/.test(host)) return 'primevideo';
    return NAMES.find((n) => host.includes(n.replace(/plus$/, ''))) || null;
  }

  return { SITES, NAMES, REQUIRED, OPTIONAL, ANY_SITE, adapterFile, normalizeAddress, patternOf, hostOf, pathOf, scriptId, covers, overlap, addedTo, addProblem, guessSite };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = IMDBEXT_SITES;
