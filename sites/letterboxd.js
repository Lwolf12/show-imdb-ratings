// Site adapter for Letterboxd (letterboxd.com). Defines window.IMDBEXT_SITE,
// which content.js uses. An optional site (sites-list.js): it only runs
// once the user ticks Letterboxd in the settings and allows the site.
//
// Letterboxd is films only, and every poster names its film with the year,
// so the match is better than on the streaming sites: type movie, year
// known. Verified 2026-11-05, signed out.
//
// Posters everywhere (browse grids, lists, watchlists, diaries, profiles,
// the "similar films" rows on a film page) are
//   <div class="poster film-poster" data-production-uid="film:117621">
//     <img alt="Poster for Interstellar (2014)" class="image">
//     <a href="/film/interstellar/" class="frame" title="Interstellar (2014) 4.46">
//       <span class="frame-title">Interstellar (2014)</span> ...
// position: relative, rendered late by a React component (an empty 0x0
// div until the page's scripts run). They come in sizes from 35 px wide
// (activity feeds) to 230 px; the small ones are skipped, a badge would
// cover them. Letterboxd's own hover shows its rating (the frame's
// title), which is left alone.
//
// A film's own page (/film/<slug>/): a masthead whose .details holds
// <h1 class="headline-1 primaryname">, a .releasedate span with the year
// and the director credits; the chip goes at the end of .details.

(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // "Poster for Interstellar (2014)" / "Interstellar (2014)" -> name, year
  const NAMED = /^(?:poster for\s+)?(.+?)\s*\((\d{4})\)\s*$/i;
  const MIN_WIDTH = 60;

  function posterName(el) {
    const frame = el.querySelector('.frame-title');
    const img = el.querySelector('img[alt]');
    return clean((frame && frame.textContent) || (img && img.alt) || '');
  }
  const parse = (text) => {
    const m = clean(text).match(NAMED);
    return m ? { title: m[1], year: m[2] } : { title: clean(text).replace(/^poster for\s+/i, '') || null, year: null };
  };

  window.IMDBEXT_SITE = {
    name: 'letterboxd',

    targets: [
      {
        kind: 'card',
        selector: '.film-poster',
        titleOf(el) {
          // Not rendered yet (0 wide) or too small for a badge: left for a
          // later scan, which the page's own rendering triggers.
          if (el.getBoundingClientRect().width < MIN_WIDTH) return null;
          return parse(posterName(el)).title;
        },
        typeOf() {
          return 'movie';
        },
        yearOf(el) {
          return parse(posterName(el)).year;
        },
        host(el) {
          return el;
        },
      },
      {
        // A film's own page.
        kind: 'detail',
        selector: '.production-masthead .details h1.primaryname',
        titleOf(el) {
          return clean(el.textContent) || null;
        },
        typeOf() {
          return 'movie';
        },
        yearOf(el) {
          const y = el.parentElement.querySelector('.releasedate');
          return y ? (clean(y.textContent).match(/\d{4}/) || [null])[0] : null;
        },
        host(el) {
          return el.parentElement;
        },
      },
    ],
  };
})();
