// Site adapter for Paramount+ (www.paramountplus.com, which includes
// Showtime). Defines window.IMDBEXT_SITE, which content.js uses.
//
// Paramount+'s web app (verified signed in, 2026-10-24). Tiles are
// <a class="link" title="Tulsa King" aria-label="..."> (position:static)
// around a .thumb-wrapper (relative, clipped; the tall "Now Featuring"
// cards have a .prominent-thumb-wrapper instead), where the badge goes. Shows
// link to /shows/<slug>/, movies to /movies/video/<id>/; brand, collection
// and live-TV tiles link elsewhere and are skipped, and so are the rows of
// live games (rows carry data-ci="schedule-<id>", whose games link to
// /shows/ too). On the home page rows are [data-ci="showMovieHybrid-..."],
// "keepWatching-...", "watchlist"; on /movies/ and /shows/ the tiles sit
// outside such rows.
//
// A show's page (/shows/<slug>/): .hero__grid with the title in
// "h1 img[alt]" and .showBadging reading "Comedy 2022 4 TV-MA" (the year
// is the first season's), where the chip goes. Episodes:
// section[data-ci="latest-episodes"], one article.grid-view-item each, with
// <abbr class="season-inline" title="Season 1">S1</abbr> and title="Episode
// 1"; the rating joins the "41M · Nov 13, 2022" line in .info-wrapper.
// A movie's page (/movies/video/<id>/, 2026-11-03; it used to open straight
// into the player): .hero__grid with the title in "h1 .movieLogo img[alt]"
// and, next to the grid, .movie__meta-container holding the
// .movie__sub-metadata line "COMEDY 2022 TV-MA 48M" (the year in
// .movie__air-year), after which the chip goes.
//
// A show card's title can carry an episode or clip name after the show's
// ("South Park - South American Biker Gangs", a /shows/south-park link):
// the leading part that matches the link's slug is the title (showPart).
//
// Home page banner: .hero__grid slides with the title in "h1 img[alt]"
// ("Tulsa King "), no year, and right after the h1 a call-out ("NEW EPISODE
// NOW STREAMING", "NEW MOVIE ...", "NEW SPECIAL ...") that gives the type.
// Slides whose call-out names neither (sports events like "UFC 333") are
// skipped. Beside the banner, its poster strip (2026-11-03): the slider's
// pagination, span.swiper-pagination-bullet[data-pos] with a poster and
// no name, where data-pos is the index of the slide it stands for; the
// slide gives the title and type. Bullets beyond the strip are hidden
// until the slider turns to them.

(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function linkType(a) {
    let path = '';
    try {
      path = new URL(a.getAttribute('href') || '', location.href).pathname;
    } catch (e) {
      return null;
    }
    if (/^\/movies\/video\//.test(path)) return 'movie';
    if (/^\/shows\/[^/]+\/?$/.test(path)) return 'series';
    return null;
  }

  // "Season 1" / "Episode 1" from an episode's abbr titles.
  function abbrNumber(el, word) {
    for (const a of el.querySelectorAll('abbr.season-inline[title]')) {
      const m = a.getAttribute('title').match(new RegExp('^' + word + '\\s+(\\d+)$', 'i'));
      if (m) return Number(m[1]);
    }
    return null;
  }

  // A title as Paramount+ spells it in a link: "Mayor of Kingstown" ->
  // "mayor-of-kingstown".
  const slugOf = (s) =>
    (s || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/['’.]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  // A show page's first year, from "Drama 2024 2 Seasons TV-MA".
  function showYear(grid) {
    for (const d of grid.querySelectorAll('.showBadging div')) {
      const t = clean(d.textContent);
      if (/^(19|20)\d\d$/.test(t)) return t;
    }
    return null;
  }

  const onShowPage = () => /^\/shows\/[^/]+\/?$/.test(location.pathname);
  const onMoviePage = () => /^\/movies\/video\//.test(location.pathname);

  // Of a show link's name, the leading " - " part that matches the link's
  // slug (/shows/south-park): the show's title without an episode or clip
  // name after it. null when no part matches (UFC fight cards, renamed
  // shows).
  function showPart(el, name) {
    const slug = (new URL(el.href).pathname.match(/^\/shows\/([^/]+)/) || [])[1] || '';
    const want = slug.replace(/_/g, '-');
    const parts = name.split(' - ');
    for (let n = parts.length; n >= 1; n--) {
      const candidate = clean(parts.slice(0, n).join(' - '));
      if (slugOf(candidate) === want) return candidate;
    }
    return null;
  }

  // The call-out right after the banner's logo heading.
  const bannerCall = (el) => el.querySelector(':scope > h1')?.nextElementSibling || null;

  function bannerType(el) {
    const call = clean(bannerCall(el)?.textContent);
    if (/\b(seasons?|episodes?|series)\b/i.test(call)) return 'series'; // "ALL EPISODES NOW STREAMING" too
    if (/\b(movie|special)\b/i.test(call)) return 'movie'; // a TV special is a film to IMDb (builder.js TYPE)
    return null;
  }

  // The banner slide (.hero__grid) a poster-strip bullet stands for.
  function bulletSlide(bullet) {
    const n = Number(bullet.dataset.pos);
    const slides = document.querySelectorAll('#hero-content-slider li.hero__slide:not(.swiper-slide-duplicate)');
    return Number.isInteger(n) && slides[n] ? slides[n].querySelector('.hero__grid') : null;
  }

  window.IMDBEXT_SITE = {
    name: 'paramountplus',

    targets: [
      {
        kind: 'card',
        selector: 'a.link[title][href*="/shows/"], a.link[title][href*="/movies/video/"]',
        titleOf(el) {
          if (el.closest('[data-ci^="schedule"]') || !linkType(el)) return null;
          // Tall "Now Featuring" cards carry a genre line; sports ones
          // (UFC, college football) aren't titles IMDb rates.
          if (/^sports$/i.test(clean(el.querySelector('.prominent-metadata')?.textContent))) return null;
          const name = clean(el.getAttribute('title'));
          if (!name) return null;
          // A show named with an episode after it: the show's part, or the
          // whole name when no part matches the slug (as before).
          return linkType(el) === 'series' ? showPart(el, name) || name : name;
        },
        typeOf: linkType,
        host(el) {
          return el.querySelector('.thumb-wrapper, .prominent-thumb-wrapper');
        },
      },
      {
        // "You May Also Like" on a show page: the same tiles without a title
        // attribute. The only name is the image's alt, which for a show adds
        // a caption ("Marshals - Piya Wiconi"), so the show's part (showPart)
        // is the title; no match means no badge. A movie's alt is its title
        // ("The Running Man (2025)").
        kind: 'card',
        selector: 'a.link:not([title])[href*="/shows/"], a.link:not([title])[href*="/movies/video/"]',
        titleOf(el) {
          const type = linkType(el);
          const alt = clean(el.querySelector('.thumb-wrapper img[alt]')?.alt);
          if (!type || !alt) return null;
          return type === 'movie' ? alt : showPart(el, alt);
        },
        typeOf: linkType,
        host(el) {
          return el.querySelector('.thumb-wrapper');
        },
      },
      {
        // A show's own page; the chip follows the genre / year / seasons line.
        kind: 'detail',
        selector: '.hero__grid:has(.showBadging)',
        titleOf(el) {
          return onShowPage() ? clean(el.querySelector('h1 img[alt]')?.alt) || null : null;
        },
        typeOf() {
          return 'series';
        },
        yearOf: showYear,
        host(el) {
          return el;
        },
        place(host, badge) {
          const after = host.querySelector(':scope > .showBadging');
          if (after) after.after(badge);
          else host.appendChild(badge);
        },
      },
      {
        // A movie's own page; the chip follows the genre / year / rating /
        // length line beside the grid.
        kind: 'detail',
        selector: '.hero__grid:has(> h1 .movieLogo img[alt])',
        titleOf(el) {
          return onMoviePage() ? clean(el.querySelector('.movieLogo img[alt]')?.alt) || null : null;
        },
        typeOf() {
          return 'movie';
        },
        yearOf(el) {
          const y = clean(el.parentElement?.querySelector('.movie__air-year')?.textContent);
          return /^(19|20)\d\d$/.test(y) ? y : null;
        },
        host(el) {
          return el.parentElement?.querySelector('.movie__meta-container') || el;
        },
        place(host, badge) {
          const after = host.querySelector(':scope > .movie__sub-metadata');
          if (after) after.after(badge);
          else host.appendChild(badge);
        },
      },
      {
        // Home page banner slides.
        kind: 'detail',
        selector: '.hero__grid:not(:has(.showBadging)):not(:has(.movieLogo)):has(> h1)',
        titleOf(el) {
          if (!bannerType(el)) return null;
          return clean(el.querySelector('img[alt]')?.alt) || null;
        },
        typeOf: bannerType,
        host(el) {
          return el;
        },
        place(host, badge) {
          const after = bannerCall(host);
          if (after) after.after(badge);
          else host.appendChild(badge);
        },
      },
      {
        // The banner's poster strip: each bullet is rated as its slide.
        kind: 'card',
        selector: '#hero-content .swiper-pagination-bullet[data-pos]',
        titleOf(el) {
          const grid = bulletSlide(el);
          return grid && bannerType(grid) ? clean(grid.querySelector('img[alt]')?.alt) || null : null;
        },
        typeOf(el) {
          const grid = bulletSlide(el);
          return grid ? bannerType(grid) : null;
        },
        host(el) {
          return el;
        },
      },
      {
        // A show page's episode grid; each episode names its own season.
        kind: 'episodes',
        selector: 'section[data-ci="latest-episodes"]',
        showOf() {
          const grid = document.querySelector('.hero__grid:has(.showBadging)');
          return onShowPage() && grid ? clean(grid.querySelector('h1 img[alt]')?.alt) || null : null;
        },
        yearOf() {
          const grid = document.querySelector('.hero__grid:has(.showBadging)');
          return grid ? showYear(grid) : null;
        },
        seasonOf(el) {
          const first = this.items(el)[0];
          return first ? first.season : null;
        },
        items(el) {
          return [...el.querySelectorAll('article.grid-view-item')]
            .map((item) => {
              const season = abbrNumber(item, 'season');
              const number = abbrNumber(item, 'episode');
              const row = item.querySelector('.info-wrapper');
              return season != null && number != null && row ? { season, number, row } : null;
            })
            .filter(Boolean);
        },
      },
    ],

    watchAttributes: ['aria-label', 'title', 'href', 'alt'],
  };
})();
