// Site adapter for Netflix. Defines window.IMDBEXT_SITE, which content.js uses.
//
// Netflix's 2026 UI uses hashed class names, but marks each card anchor with a
// stable data-uia attribute and puts the title in its aria-label. Cards are
// 262x147 landscape tiles inside horizontal carousels. Hovering a card opens a
// preview popup (.previewModal--wrapper.mini-modal); clicking "more" opens the
// full detail modal (.previewModal--wrapper.detail-modal). Both carry the
// title as the alt text of their box-art image.
//
// To support another service, add a sibling file that defines the same shape
// and list it in manifest.json for that site's URLs.

// The detail modal's "2013 5 Seasons" line, or ''.
function videoMeta(el) {
  return (el.querySelector('[data-uia="videoMetadata--container"]')?.textContent || '').trim();
}

// Netflix writes its labels in the profile's language, so the words that
// tell a show from a film, a season from a running time, are matched in
// the languages the extension reads: English and Polish checked on the
// site, German, French, Spanish, Portuguese, Italian and Dutch from
// Netflix's usual wording there. In another language the titles still
// match (db.js LANGUAGES); only the type, year and season hints are lost.
const SEASON = 'seasons?|sezon(?:y|ów)?|staffeln?|saisons?|temporadas?|stagion[ei]|seizoen(?:en)?';
const EPISODE = 'episodes?|odcin(?:ek|ki|ków)|folgen?|épisodes?|epis[oó]dios?|episod[io]|afleveringe?n?';
const PART = 'parts?|część|części|teile?|parties?|partes?|part[ei]|de(?:el|len)|volumes?|tomy?|bände?';
const LIMITED = 'limited series|mini-?series|miniserial|miniserie|mini-série|minissérie';
// "Show", "Serial" (pl), "Serie" (de, es, it, nl), "Série" (fr, pt),
// "Program" (pl billboard); "Movie", "Film", "Filme" (pt), "Película".
// Not followed by a lower-case letter: textContent runs the pieces together
// ("FilmR2 godz. 11 minHD"), so \b would not do. Case-sensitive, since
// with the i flag \p{Ll} would match the "R" too; Netflix capitalises.
const SERIES_WORD = /^(Show|Series|Serial|Serie|Série|Program|Programa)(?!\p{Ll})/u;
const MOVIE_WORD = /^(Movie|Film|Filme|Película|Pelicula)(?!\p{Ll})/u;
// A film's running time: "2h 50m", "2 godz. 50 min", "2 Std. 50 Min.", "2 h 50 min".
const RUNTIME = /^\s*(\d+\s*(h|hr|std\.?|godz\.?|u\.?|ore?|uur)\s*)?(\d+\s*(m|min\.?))?\s*$/iu;
// A watched show's "S1:E3" line, with the episode letter in Netflix's
// language ("S1:O1" in Polish).
const SEASON_EPISODE = /S\d+:\p{Lu}\d+/u;
// "Season 2" -> 2 in the episode list's dropdown.
const SEASON_NUMBER = new RegExp('(?:' + SEASON + ')\\s*(\\d+)', 'iu');
const LIMITED_SERIES = new RegExp(LIMITED, 'iu');

// "Episodes & info" on an episode card's preview opens the show's detail
// modal in episode view: the episode list is the show's, but the box art,
// story art and tab title all name the episode ("Pilot") and the metadata
// line gives the episode's running time ("2008 58m") instead of "5 Seasons".
// SHOW_LENGTH is a show's length in that line: "5 Seasons", "8 Episodes",
// "Limited Series", "2 Parts", "5 sezonów". No word boundaries: textContent
// runs the pieces together ("20135 SeasonsHD").
const SHOW_LENGTH = new RegExp('\\d+\\s*(' + SEASON + '|' + EPISODE + '|' + PART + ')|' + LIMITED, 'iu');

function isEpisodeView(modal) {
  return (
    !!modal &&
    !!modal.querySelector('[data-uia="episode-selector"]') &&
    !SHOW_LENGTH.test(videoMeta(modal))
  );
}

// ------------------------------------------------- episodes -> their show
//
// Episode cards (a[data-uia="episodic-card"], rows like "Hooked from the
// First Episode") name only the episode ("Pilot"), and so do their preview
// and the "Episodes & info" view; nothing on the page names the show. They
// do carry the episode's Netflix id (href "/browse?jbv=70196252"), and
// Netflix redirects /title/<episode id> to /title/<show id>. Netflix's
// signed-out version of that show page names the show in its <h1>, about
// 600 KB in, so the page is read only up to there. The answers are kept
// for good (storage.local nfShows: show id -> name, nfEpisodes: episode id
// -> show id), so each episode costs one request ever. Show cards
// (href "/browse?jbv=<show id>", aria-label = name) and show detail modals
// fill in names on the way, so a known show needs no page read at all.

const nf = {
  shows: {}, // Netflix show id -> name
  episodes: {}, // Netflix episode id -> show id
  pending: new Set(),
  failed: {}, // episode id -> time of the last failed attempt
  queue: [],
  active: 0,
  lastEpisodeCard: null, // { id, label } of the episode card last hovered
};
const RETRY_FAILED_MS = 10 * 60 * 1000;

function jbvOf(s) {
  return ((s || '').match(/[?&]jbv=(\d+)/) || [])[1] || null;
}

// Netflix id of the title a detail modal shows, from the address bar
// (/browse?jbv=<id> or /title/<id>).
function modalId() {
  return jbvOf(location.search) || (location.pathname.match(/^\/title\/(\d+)/) || [])[1] || null;
}

function nfRescan() {
  document.dispatchEvent(new Event('imdbext-rescan'));
}

let nfSaveTimer = null;
function nfSave() {
  if (nfSaveTimer) return;
  nfSaveTimer = setTimeout(async () => {
    nfSaveTimer = null;
    try {
      const cur = await chrome.storage.local.get(['nfShows', 'nfEpisodes']);
      await chrome.storage.local.set({
        nfShows: { ...(cur.nfShows || {}), ...nf.shows },
        nfEpisodes: { ...(cur.nfEpisodes || {}), ...nf.episodes },
      });
    } catch (e) {
      /* extension reloaded; the next page load starts over */
    }
  }, 2000);
}

function rememberShow(id, name) {
  if (id && name && nf.shows[id] !== name) {
    nf.shows[id] = name;
    nfSave();
  }
}

// The show an episode belongs to, or null while that is being worked out
// (a rescan follows once it is known).
function showOfEpisode(episodeId) {
  if (!episodeId) return null;
  const showId = nf.episodes[episodeId];
  if (showId && nf.shows[showId]) return nf.shows[showId];
  if (!nf.pending.has(episodeId) && !(Date.now() - (nf.failed[episodeId] || 0) < RETRY_FAILED_MS)) {
    nf.pending.add(episodeId);
    nf.queue.push(episodeId);
    nfPump();
  }
  return null;
}

function nfPump() {
  while (nf.active < 2 && nf.queue.length) {
    const id = nf.queue.shift();
    nf.active++;
    resolveEpisode(id).finally(() => {
      nf.active--;
      nf.pending.delete(id);
      nfPump();
    });
  }
}

async function resolveEpisode(episodeId) {
  const ctrl = new AbortController();
  try {
    // A full URL: Firefox resolves a content script's relative URLs against
    // the extension, not the page.
    const res = await fetch(location.origin + '/title/' + episodeId, { credentials: 'omit', signal: ctrl.signal });
    const showId = (res.url.match(/\/title\/(\d+)/) || [])[1];
    if (!res.ok || !showId) throw new Error('no show page');
    nf.episodes[episodeId] = showId;
    if (!nf.shows[showId]) {
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (let read = 0; read < 3e6; ) {
        const { done, value } = await reader.read();
        if (done) break;
        read += value.length;
        buf += value;
        const m = buf.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (m) {
          const name = new DOMParser().parseFromString(m[1], 'text/html').body.textContent.trim();
          if (name) nf.shows[showId] = name;
          break;
        }
        buf = buf.slice(-8192); // an <h1> split across chunks still matches next time
      }
    }
    if (!nf.shows[showId]) throw new Error('no name');
    nfSave();
    nfRescan();
  } catch (e) {
    nf.failed[episodeId] = Date.now();
  } finally {
    ctrl.abort(); // stop downloading the rest of the page
  }
}

chrome.storage.local.get(['nfShows', 'nfEpisodes']).then(
  ({ nfShows, nfEpisodes }) => {
    nf.shows = { ...(nfShows || {}), ...nf.shows };
    nf.episodes = { ...(nfEpisodes || {}), ...nf.episodes };
    nfRescan();
  },
  () => {}
);

// Which episode card a preview popup belongs to: the one last hovered.
document.addEventListener(
  'mouseover',
  (e) => {
    const card = e.target instanceof Element && e.target.closest('a[data-uia="episodic-card"]');
    if (card) nf.lastEpisodeCard = { id: jbvOf(card.getAttribute('href')), label: (card.getAttribute('aria-label') || '').trim() };
  },
  true
);

// The title a preview popup or detail modal is about. Episode previews and
// the episode view name the episode, so those are resolved to their show.
function modalTitle(el) {
  const img = el.querySelector('img.previewModal--boxart, img.playerModel--player__storyArt');
  const title = (img && img.alt.trim()) || null;
  if (isEpisodeView(el)) return showOfEpisode(jbvOf(location.search));
  // An episode preview: box art "Days Gone Bye" and the line S1:E1 "Days
  // Gone Bye" (in Polish S1:O1 Days Gone Bye, without the quotes). A show's
  // preview with a watched episode also has an S1:E3 line, but there the
  // box art names the show, so the two differ. No \b before the S:
  // textContent runs words together ('…matchS1:E1').
  const ep = el.textContent.match(/S\d+:\p{Lu}\d+\s*["“]?/u);
  const after = ep ? el.textContent.slice(ep.index + ep[0].length).trim().toLowerCase() : '';
  // The box art must name the whole episode, not the start of a longer
  // name: a show called "Dark" with a watched episode "Darkness Falls"
  // is the show's own preview.
  const t = title ? title.toLowerCase() : '';
  if (title && ep && after.startsWith(t) && !/[\p{L}\p{N}]/u.test(after.charAt(t.length))) {
    const card = nf.lastEpisodeCard;
    return card && card.label.toLowerCase() === title.toLowerCase() ? showOfEpisode(card.id) : null;
  }
  if (title && el.classList.contains('detail-modal')) rememberShow(modalId(), title);
  return title;
}

window.IMDBEXT_SITE = {
  name: 'netflix',

  targets: [
    {
      // Small badge in the corner of each tile. Only looked up near the viewport.
      // Also where show names are learned: href "/browse?jbv=<show id>".
      kind: 'card',
      selector: [
        'a[data-uia="standard-card"]',
        'a[data-uia="ranked-card"]',
        'a[data-uia="progress-card"]',
      ].join(', '),
      titleOf(el) {
        const name = (el.getAttribute('aria-label') || '').trim() || null;
        rememberShow(jbvOf(el.getAttribute('href')), name);
        return name;
      },
      host(el) {
        return el;
      },
    },
    {
      // New & Popular (/latest) still uses the older card:
      // [data-uia="title-card-container"] > .title-card > a.slider-refocus
      // with the title in its aria-label and the image in .boxart-container
      // (already position: relative). Its "Coming This Week", "Coming Next
      // Week" and "Worth the Wait" rows ([data-list-context=
      // "windowedComingSoon"]) list titles not out yet, often sharing a name
      // with an older film ("Inside", "Champions"); with no year on the
      // card, those would show the older film's rating, so they get none.
      // Their hover preview has a year and is handled as usual.
      kind: 'card',
      selector: '[data-uia="title-card-container"]',
      titleOf(el) {
        if (el.closest('[data-list-context="windowedComingSoon"]')) return null;
        return (el.querySelector('a.slider-refocus')?.getAttribute('aria-label') || '').trim() || null;
      },
      host(el) {
        return el.querySelector('.boxart-container');
      },
    },
    {
      // "More Like This" in the full detail modal: div[data-uia=
      // "titleCard--container"] with the title in its aria-label, the image
      // in .titleCard-imageWrapper (already position: relative) and a
      // running time ("2h 50m") or a show's length ("3 Seasons") in its
      // top-right corner, so the badge goes top-left (badge.css). The year
      // under the image is a film's release year but a show's latest
      // season, so it is passed only for films.
      kind: 'card',
      selector: '.moreLikeThis--container [data-uia="titleCard--container"]',
      titleOf(el) {
        return (el.getAttribute('aria-label') || '').trim() || null;
      },
      typeOf(el) {
        const length = el.querySelector('.duration')?.textContent || '';
        if (SHOW_LENGTH.test(length)) return 'series';
        return RUNTIME.test(length) && /\d/.test(length) ? 'movie' : null;
      },
      yearOf(el) {
        if (this.typeOf(el) !== 'movie') return null;
        const m = (el.querySelector('.year')?.textContent || '').match(/\b(19|20)\d\d\b/);
        return m ? m[0] : null;
      },
      host(el) {
        return el.querySelector('.titleCard-imageWrapper');
      },
    },
    {
      // Episode cards: the show's rating, once the episode's show is known.
      kind: 'card',
      selector: 'a[data-uia="episodic-card"]',
      titleOf(el) {
        return showOfEpisode(jbvOf(el.getAttribute('href')));
      },
      typeOf() {
        return 'series';
      },
      host(el) {
        return el.querySelector('[data-uia="episodic-card+still"]') || el;
      },
    },
    {
      // Featured banner at the top of the home page: [data-uia="billboard"]
      // with aria-label "Featured Content: <title>[, <season name>][, Show]"
      // ("Polecane treści: <title>" in Polish). The season name is free
      // text ("Season 1", "East Blue", "Limited Series") and the logo image
      // has no usable alt, so the label is the only title source.
      // Candidates are tried in order: the whole label first (titles can
      // contain commas), then with trailing comma segments dropped one at a
      // time. In a language whose prefix is not known here, the part after
      // the first colon goes last, since "Star Trek: Discovery" must be
      // tried whole first. The chip goes in the Play / More Info row.
      kind: 'detail',
      selector: '[data-uia="billboard"]',
      titleOf(el) {
        const label = (el.getAttribute('aria-label') || '').trim();
        const known = /^(featured content|polecane treści):\s*/iu;
        let t = label.replace(known, '');
        t = t.replace(/,\s*(show|movie|film|serial|program)\s*$/iu, '').trim();
        if (!t) return null;
        const parts = t.split(/\s*,\s*/);
        const out = [];
        for (let n = parts.length; n >= 1; n--) out.push(parts.slice(0, n).join(', '));
        const prefixed = !known.test(label) && t.match(/^[^:,]{3,40}:\s+(.+)$/);
        if (prefixed) out.push(prefixed[1]);
        return out;
      },
      // The attribute row starts with "Show" or "Movie" ("Program" or
      // "Film" in Polish).
      typeOf(el) {
        const first = (el.querySelector('[data-uia="attributes-elements"]')?.textContent || '').trim();
        if (SERIES_WORD.test(first)) return 'series';
        if (MOVIE_WORD.test(first)) return 'movie';
        return null;
      },
      host(el) {
        return el.querySelector('[data-uia="billboard-actions"]');
      },
      place(host, badge) {
        host.appendChild(badge);
      },
    },
    {
      // Detail line (rating, year, votes) inside the hover preview / detail
      // modal. The hover preview names the title in img.previewModal--boxart;
      // the full detail modal (from "More info" or a /title/ link) in its
      // story art, img.playerModel--player__storyArt. See modalTitle for
      // episode previews and the episode view.
      kind: 'detail',
      selector: '.previewModal--wrapper',
      titleOf: modalTitle,
      // Cards carry no type or year, but the popup does: a "Show|Drama" or
      // "Movie|Action" line ([data-uia="makeover-content-type-genre"]) and a
      // "2026•7 Episodes•TV-MA•HD" line ([data-uia="makeover-metadata"]);
      // the newer popup has instead a "Film R 2h 11m HD" line
      // ([data-uia="videoMetadata--container"]) starting with the type.
      // Both hints fix titles that would otherwise match a same-named older
      // film (East of Eden, 2026 series vs 1955 film). Watched shows show
      // "S1:E3" instead of the type line.
      // The detail modal has neither line; its "2013 5 Seasons" line
      // ([data-uia="videoMetadata--container"]) says series, and for a series
      // that year is the latest season's, so it is not used as a hint.
      typeOf(el) {
        const line = el.querySelector('[data-uia="makeover-content-type-genre"]');
        const first = line ? line.textContent.split('|')[0].trim() : videoMeta(el);
        if (SERIES_WORD.test(first)) return 'series';
        if (MOVIE_WORD.test(first)) return 'movie';
        if (SHOW_LENGTH.test(videoMeta(el))) return 'series';
        if (el.querySelector('[data-uia="episode-selector"]')) return 'series';
        return SEASON_EPISODE.test(el.textContent) ? 'series' : null;
      },
      // An episode's year (preview or episode view) is not the show's, so
      // only titles without an S:E line or episode list give a year hint.
      yearOf(el) {
        if (SEASON_EPISODE.test(el.textContent) && el.classList.contains('mini-modal')) return null;
        const meta = el.querySelector('[data-uia="makeover-metadata"]');
        let m = meta && meta.textContent.match(/\b(19|20)\d\d\b/);
        if (!m && !el.querySelector('[data-uia="episode-selector"]')) m = videoMeta(el).match(/\b(19|20)\d\d\b/);
        return m ? m[0] : null;
      },
      host(el) {
        return (
          el.querySelector('.previewModal--metadatAndControls-container') ||
          el.querySelector('.previewModal--info')
        );
      },
      // Own line directly under the play / add / rate buttons. In the full
      // detail modal, .previewModal--info has no padding of its own: its
      // content sits in .detail-modal-container (48px sides), so the line
      // goes in there to line up with Netflix's text instead of the edge.
      place(host, badge) {
        const controls = host.querySelector('[data-uia$="-controls"]');
        if (controls && controls.parentElement === host) controls.after(badge);
        else (host.querySelector(':scope > .detail-modal-container') || host).prepend(badge);
      },
    },
    {
      // Episode list in the detail modal: [data-uia="episode-selector"], a
      // season dropdown ("Season 2") and one .episode-item per episode with
      // its number in .titleCard-title_index and a .titleCardList-title row
      // ("<title> <duration>") where the rating goes. Matched to IMDb by
      // series + season + episode number, so titles don't have to agree.
      kind: 'episodes',
      selector: '[data-uia="episode-selector"]',
      showOf(el) {
        const modal = el.closest('.previewModal--wrapper');
        return modal ? modalTitle(modal) : null;
      },
      // "Season 2" ("Sezon 2") -> 2. Some shows name seasons after
      // themselves ("Stranger Things 5" -> 5, and plain "Stranger Things"
      // for the first). No dropdown (one season) or "Limited Series" -> 1.
      // Anything else ("Part 2", "Volume 1") doesn't map onto IMDb's
      // seasons reliably, so those lists get no ratings.
      seasonOf(el) {
        const toggle = el.querySelector('[data-uia="dropdown-toggle"]');
        const text = ((toggle ? toggle.textContent : el.querySelector('.episodeSelector-header')?.textContent) || '').trim();
        const m = text.match(SEASON_NUMBER);
        if (m) return Number(m[1]);
        const named = text.match(/^(.*\S)\s+(\d+)$/);
        const show = this.showOf(el);
        const key = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (named && show && key(named[1]) === key(show)) return Number(named[2]);
        if (show && key(text) === key(show)) return 1;
        if (!toggle || LIMITED_SERIES.test(text)) return 1;
        return null;
      },
      // Anthologies (Black Mirror) list their episodes without the number;
      // when no row has one, the list's order gives it (1, 2, 3, ...).
      items(el) {
        const rows = [...el.querySelectorAll('.episode-item')];
        const numbered = rows.some((item) => item.querySelector('.titleCard-title_index'));
        return rows
          .map((item, i) => ({
            number: numbered ? Number((item.querySelector('.titleCard-title_index')?.textContent || '').trim()) : i + 1,
            row: item.querySelector('.titleCardList-title'),
          }))
          .filter((i) => Number.isInteger(i.number) && i.number > 0 && i.row);
      },
      // Between the episode title and its duration.
      place(row, badge) {
        const title = row.querySelector('.titleCard-title_text');
        if (title) title.after(badge);
        else row.appendChild(badge);
      },
    },
  ],

  // Attributes whose changes mean a title may have changed.
  watchAttributes: ['aria-label', 'alt'],
};
