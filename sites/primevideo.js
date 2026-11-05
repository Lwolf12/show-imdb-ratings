// Site adapter for Prime Video (amazon.com/gp/video/... and primevideo.com).
// Defines window.IMDBEXT_SITE, which content.js uses.
//
// Prime's 2026 storefront (verified in Chrome): title cards are
// <article data-testid="card" data-card-title="..." data-card-entity-type="TV Show|Movie">,
// 290x163, position:relative, overflow:hidden. Hovering expands the card in
// place and adds [data-testid="standard-mini-details"] with a
// [data-testid="metadata-default"] row (maturity rating, stars, year).
// Large portrait cards are [data-testid="super-carousel-card"] (the
// "Featured Originals" rows): the poster link and its focus button carry
// the title as aria-label, and a status badge says NEW SERIES, NEW SEASON
// or NEW MOVIE. One card at a time is expanded, in place, to a wide
// panel with a Play link, a watchlist button and a metadata footer
// (maturity, genre, Amazon's stars, runtime or seasons); its first
// <a aria-label> is then "Play", so the title must come from the poster
// link, not the first link. The top banner is [data-testid="top-hero-card"],
// which names the title in an <a aria-label> and in image alt text.
//
// Card titles often carry season suffixes ("Yellowstone - Season 1",
// "The First 48 S22"), which must be stripped before an OMDb lookup.

(() => {
  const SUFFIXES = [
    /\s*[-–:,]?\s*season\s*\d+\s*$/i,
    /\s*[-–:,]?\s*series\s*\d+\s*$/i,
    /\s+s\d{1,2}\s*$/i,
    /\s*[-–:]\s*(the\s+)?complete\s+(first|second|third|fourth|fifth|\w+)\s+season\s*$/i,
    /\s*[\(\[](4k|uhd|4k uhd|ultra hd|hd|unrated|extended|director'?s cut)[\)\]]\s*$/i,
  ];

  function cleanTitle(raw) {
    let t = (raw || '').replace(/\s+/g, ' ').trim();
    let prev;
    do {
      prev = t;
      for (const re of SUFFIXES) t = t.replace(re, '');
      t = t.trim();
    } while (t !== prev && t);
    // Promo banners ("Subscribe to CNN to stream 24/7 live news.") are not
    // titles; a long string ending in a full stop is almost always one.
    if (t.length > 40 && /[.!?]$/.test(t)) return null;
    return t || null;
  }

  function typeFromEntity(entity) {
    if (!entity) return null;
    if (/movie|film/i.test(entity)) return 'movie';
    if (/tv|show|series|season/i.test(entity)) return 'series';
    return null;
  }

  function visibleYearBadge(el) {
    return [...el.querySelectorAll('[data-automation-id="release-year-badge"]')].find((y) => y.getBoundingClientRect().width > 0) || null;
  }

  function articleTitle(article) {
    return cleanTitle(article.getAttribute('data-card-title'));
  }

  // The title on a title page's hero: the title-art image's alt, or else the
  // page title, "Watch Carrie - Season 1 | Prime Video".
  function atfTitle(el) {
    const art = el.querySelector('[data-testid="title-art"] img[alt]');
    const fromArt = cleanTitle((art && art.alt) || '');
    if (fromArt) return fromArt;
    return cleanTitle(document.title.replace(/^watch\s+/i, '').replace(/\s*\|\s*prime video\s*$/i, ''));
  }

  function ariaOrAltTitle(el) {
    const a = el.querySelector('a[aria-label]');
    const img = el.querySelector('img[alt]');
    return cleanTitle((a && a.getAttribute('aria-label')) || (img && img.alt) || '');
  }

  window.IMDBEXT_SITE = {
    name: 'primevideo',

    targets: [
      {
        kind: 'card',
        selector: 'article[data-testid="card"][data-card-title]',
        titleOf: articleTitle,
        typeOf(el) {
          return typeFromEntity(el.getAttribute('data-card-entity-type'));
        },
        host(el) {
          return el;
        },
      },
      {
        kind: 'card',
        selector: '[data-testid="super-carousel-card"]',
        titleOf(el) {
          const named = el.querySelector('[data-testid="poster-link"][aria-label], [data-testid="poster-focus-button"][aria-label]');
          const art = el.querySelector('[data-testid="title-art"] img[alt]');
          return cleanTitle((named && named.getAttribute('aria-label')) || (art && art.alt) || '') || ariaOrAltTitle(el);
        },
        typeOf(el) {
          // The status badge ("NEW SERIES", "NEW MOVIE"; "TOP 10" says
          // nothing) and, expanded, the metadata footer ("2 seasons" or a
          // runtime). Without it "The Greatest" (a 2026 series) got the
          // 2009 film's rating.
          const text = [...el.querySelectorAll('[data-testid="status-badge"], [data-testid="metadata-badge"], [data-testid="meta-footer"]')].map((e) => e.textContent).join(' ');
          if (/\b(series|season|episode)s?\b/i.test(text)) return 'series';
          if (/\bmovie\b/i.test(text) || el.querySelector('[data-testid="runtime"]')) return 'movie';
          return null;
        },
        host(el) {
          return el;
        },
      },
      {
        // Top banner. Its top-right corner sits under Prime's sticky nav bar,
        // which swallows clicks there, so the rating goes in the banner's
        // button row (next to "More details") as a detail chip instead.
        kind: 'detail',
        selector: '[data-testid="top-hero-card"]',
        titleOf(el) {
          const art = el.querySelector('[data-testid="title-art"] img[alt]');
          return cleanTitle((art && art.alt) || '') || ariaOrAltTitle(el);
        },
        host(el) {
          return el.querySelector('[data-testid="action-box"]') || el;
        },
        place(host, badge) {
          host.appendChild(badge);
        },
      },
      {
        // A title's own page (/gp/video/detail/<asin>): the hero is
        // [data-testid="atf-component-next-gen"], with the title as the alt
        // of the title-art image and a metadata row (star rating, release
        // year, genres) that the chip joins. The row exists twice for
        // different widths; only the visible copy gets the chip.
        kind: 'detail',
        selector: '[data-testid="atf-component-next-gen"]',
        titleOf: atfTitle,
        typeOf(el) {
          const play = el.querySelector('[data-automation-id="dp-atf-play-button"]');
          const badge = el.querySelector('[data-automation-id="metadata-badge"]');
          if (
            /\bseason\b/i.test(document.title) ||
            (play && /episode/i.test(play.textContent)) ||
            (badge && /series/i.test(badge.textContent))
          ) {
            return 'series';
          }
          if (el.querySelector('[data-automation-id="runtime-badge"]')) return 'movie';
          return null;
        },
        yearOf(el) {
          const y = visibleYearBadge(el);
          const m = y && y.textContent.match(/\b(19|20)\d\d\b/);
          return m ? m[0] : null;
        },
        host(el) {
          const y = visibleYearBadge(el);
          return y ? y.parentElement : null;
        },
        place(host, badge) {
          host.appendChild(badge);
        },
      },
      {
        // Detail chip in the metadata row of the expanded (hovered) card.
        kind: 'detail',
        selector: 'article[data-testid="card"] [data-testid="standard-mini-details"]',
        titleOf(el) {
          const article = el.closest('article[data-testid="card"]');
          return article ? articleTitle(article) : null;
        },
        typeOf(el) {
          const article = el.closest('article[data-testid="card"]');
          return article ? typeFromEntity(article.getAttribute('data-card-entity-type')) : null;
        },
        host(el) {
          return el.querySelector('[data-testid="metadata-default"]') || el;
        },
        place(host, badge) {
          host.appendChild(badge);
        },
      },
      {
        // Episode list on a series page: #tab-content-episodes with one
        // [data-testid="episode-list-item"] per episode, whose number and
        // title are one heading, "1. Daybreak", inside
        // [data-automation-id^="ep-title-episode-"], laid out twice. Each season is its own
        // page; the season dropdown ([data-testid="dp-season-selector"]) is
        // labelled "Season 1", as is the page title. No dropdown and no
        // season in the title means a single season.
        kind: 'episodes',
        selector: '#tab-content-episodes',
        showOf() {
          const atf = document.querySelector('[data-testid="atf-component-next-gen"]');
          return atf ? atfTitle(atf) : null;
        },
        seasonOf() {
          const label = document.querySelector('[data-testid="dp-season-selector"] label');
          const m = ((label && label.textContent) || document.title).match(/season\s*(\d+)/i);
          if (m) return Number(m[1]);
          return label ? null : 1;
        },
        items(el) {
          return [...el.querySelectorAll('[data-testid="episode-list-item"]')]
            .map((item) => {
              // The heading exists twice, for different widths (the 2026
              // grid shows the second copy); the badge goes in the visible
              // one, and a badge left in the other copy by a resize moves.
              // Any heading of the item that starts with the number counts,
              // since the copies need not share a wrapper.
              const rows = [...item.querySelectorAll('h3')].filter((r) => /^\d+\.\s/.test(r.textContent.trim()));
              const row = rows.find((r) => r.getBoundingClientRect().width > 0) || rows[0] || null;
              const stray = rows.map((r) => r !== row && r.querySelector('.imdbext-badge--episode')).find(Boolean);
              if (stray && !row.querySelector('.imdbext-badge--episode')) row.appendChild(stray);
              const m = row && row.textContent.trim().match(/^(\d+)\.\s/);
              return { number: m ? Number(m[1]) : NaN, row };
            })
            .filter((i) => Number.isInteger(i.number) && i.number > 0 && i.row);
        },
        place(row, badge) {
          row.appendChild(badge);
        },
      },
    ],

    watchAttributes: ['data-card-title', 'aria-label', 'alt'],
  };
})();
