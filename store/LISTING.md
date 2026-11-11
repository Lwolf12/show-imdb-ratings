# Chrome Web Store listing: Show IMDb Ratings on Streaming Services

Everything to paste into the developer dashboard
(<https://chrome.google.com/webstore/devconsole>). The upload ZIP is built
with `store/build-zip.ps1` and lands in `dist/`.

## Store listing tab

**Name** (from the manifest): Show IMDb Ratings on Streaming Services

**Summary** (132 characters max):

> Shows the IMDb rating on title cards while you browse Netflix, Prime Video, Hulu, HBO Max and more. Free and open source.

**Category:** Entertainment · **Language:** English

**Description:**

> See IMDb ratings without leaving your streaming site. Free, open source, and no account required.
>
> Works on Netflix, Prime Video, Disney+ and HBO Max. Hulu, Apple TV, Paramount+ and Tubi are covered too, and so is Letterboxd.
>
> As you browse, IMDb ratings appear on movie and show cards. Choose whether badges are always visible, appear only on hover, or stay hidden. Three badge sizes are available.
>
> Hovering over a title also shows its release year, vote count and a link to its IMDb page. Ratings appear on banners, title pages and individual TV episodes too.
>
> HOW IT WORKS
>
> There are two ways to get ratings: a local IMDb database for private, on-device lookups, or the free OMDb service for additional ratings and awards. You can use either one or both together.
>
> LOCAL IMDb DATABASE (DEFAULT)
>
> The extension builds its own ratings database in your browser using IMDb's public data. The initial download is about 280 MB and takes a few minutes. After that, ratings are looked up directly on your device without sending title searches to an outside service.
>
> The database can be kept current automatically, with a small weekly download and a larger monthly update. Automatic updates are optional and can be disabled. You can also refresh the database manually at any time by clicking Update now in settings.
>
> OMDb OPTION
>
> A free API key from omdbapi.com provides up to 1,000 lookups per day. Enter the key in settings to use OMDb alongside the local database or instead of it.
>
> OMDb also lets you optionally display Rotten Tomatoes scores, Metacritic scores and awards alongside IMDb ratings.
>
> If you use OMDb alone, there's no database to download or maintain. Ratings are retrieved as you browse, and results are cached for 30 days to minimize requests and stay within the daily lookup limit.
>
> The main disadvantage of using OMDb alone is that titles in other languages aren't matched, and  lookups are limited to 1000 a day.
>
> With the local database alone (Use OMDb unchecked), title lookups remain on your device. Rotten Tomatoes scores, Metacritic scores and awards won't appear because those come from OMDb.
>
> SITE SETTINGS
>
> Enable ratings only on the sites you want. The settings list every supported site, so you can turn each one on or off independently.
>
> You can also add another address that uses a supported site's layout, such as a streaming service's website in another country.
>
> OPTIONAL: TITLES IN OTHER LANGUAGES
>
> If you browse streaming sites in other languages, the extension can match titles as they appear in those languages.
>
> In settings, enable Match titles in other languages, choose your languages (from Polish to Korean, Japanese and Chinese), and click Get titles.
>
> This requires a one-time download of approximately 520 MB, of which about 40 MB is retained. It's not needed for English-language pages.
>
> PRIVACY
>
> No accounts, no analytics, no tracking, and no developer-operated server.
>
> With the local database, title lookups stay on your device. If you enable OMDb, title lookup requests are sent to OMDb. Database updates download public IMDb data.
>
> The extension reads title information from the pages it enhances. It does not collect browsing history or send personal information to the developer.
>
> Full privacy policy:
> https://lwolf12.github.io/show-imdb-ratings/PRIVACY
>
> FREE AND OPEN SOURCE
>
> The extension is completely free. Its source code is publicly available:
>
> https://github.com/Lwolf12/show-imdb-ratings
>
> Independent project, not affiliated with or endorsed by IMDb, OMDb, or any streaming service.

0.8.1 was rejected as "Keyword Spam" (Yellow Argon) for the earlier closing
line, which listed IMDb, OMDb, Netflix, Amazon, Hulu and HBO Max in a row.
The description was then trimmed to name each streaming service once and
IMDb three times plus the notice. Keep brand names out of lists and
repetition.

2026-11-08: the description now names all eight services in two sentences
(four and four, split by a full stop) plus Letterboxd; 1.3.5 passed with
five names spread over two sentences. Submitted as a listing-only change
to test it; if Chrome flags it, go back to "four more major streaming
services".

1.0.0 was rejected the same way (2026-10-25) for the summary naming all
eight services ("Netflix, Prime Video, Hulu, HBO Max, Apple TV, Disney+,
Paramount+ and Tubi"); the description had the same list. Four names
passed in 0.8.x, so the summary (the manifest's `description`, which
needs a new package to change) names four plus "and more", and the
description names none and points to the project page.

**Icon:** `icons/icon128.png` (taken from the ZIP automatically).

**Screenshots** (required, at least one; 1280×800 or 640×400 PNG/JPEG, no
alpha): take them yourself with the extension loaded, since they must show
the real thing. Suggested set:

1. Netflix browse row with badges on the tiles.
2. A Netflix hover preview showing the IMDb line with year and votes.
3. Prime Video or HBO Max title page with the rating chip in the metadata row.
4. The settings panel after a build (title count and build date visible).

Size a Chrome window to 1280×800 (DevTools → device toolbar → Responsive →
1280×800 and take the capture from there, or Win+Shift+S and crop) and avoid
anything personal in the frame (profile name, continue-watching row).

**Small promo tile** (440×280, optional; it makes the listing eligible for
featuring): `store/screenshots/v133/promo-tile-440x280.png` since 1.3.5
(abstract cards with real badges, no streaming artwork). Marquee: skipped.

**Official URL / Homepage:** https://lwolf12.github.io/show-imdb-ratings/
**Support URL:** https://lwolf12.github.io/show-imdb-ratings/

Both on GitHub Pages since 1.3.6 (2026-11-08): the submit check timed out on
github.com repo pages, which returned 504 to signed-out visitors that day.
The issue form (https://github.com/Lwolf12/show-imdb-ratings/issues/new/choose)
can go back in as the Support URL once github.com answers again.

## Privacy practices tab

**Single purpose description:**

> Overlays the IMDb user rating on title cards, banners and preview panels
> while the user browses Netflix, Prime Video, Hulu, HBO Max, Apple TV, Disney+, Paramount+ and Tubi.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Keeps the user's settings (automatic refresh on/off, OMDb on/off, optional OMDb API key) and the ratings already looked up, so each title is fetched once. |
| `unlimitedStorage` | The ratings database built from IMDb's data (about 420,000 titles) is stored in IndexedDB and exceeds the default extension quota. |
| `alarms` | A periodic alarm checks the local database's age and, if the user left automatic refresh on, re-reads the ratings file weekly and rebuilds the whole database about monthly. |
| `offscreen` | Building the database (downloading and parsing IMDb's dumps) takes minutes and runs in a Web Worker, which the service worker cannot host; an offscreen document hosts the worker. |
| Host permission `https://datasets.imdbws.com/` | Downloads IMDb's public ratings data dumps to build the local database. |
| Host permission `https://www.omdbapi.com/` | Optional fallback lookups for titles not in the local database, only when the user has entered an OMDb API key. |
| Content scripts on `www.netflix.com`, `www.primevideo.com`, `www.amazon.com/gp/video/`, `www.hulu.com`, `www.hbomax.com` (and `play.hbomax.com`, its address until November 2026), `tv.apple.com`, `www.disneyplus.com`, `www.paramountplus.com`, `tubitv.com` | Reads the title names shown on each site's title cards, banners and previews and draws the rating badge next to them. In the US Prime Video is served from amazon.com under /gp/video/, so only that path is matched; the rest of amazon.com is never touched. Each service can be switched off on the settings panel, after which the script does nothing on that site beyond one settings read. |
| `scripting` | Registers the content script for an optional site or a user-added address while the user grants it, and removes it when the grant goes; nothing is injected anywhere else. |
| Optional host permission `https://letterboxd.com/*` | Letterboxd is off until the user ticks it on the settings panel, which asks for this permission; the same script then reads film names on its posters and draws the badge. Unticking removes the permission. |
| Optional host permission `https://*/*` | Lets the user add an address of their own under one of the known sites (a country's Amazon store, www.amazon.co.uk/gp/video; a site that moved). The extension never asks for all sites: it requests exactly the address the user typed, inside their click, and registers the content script for that address only. Removing the address removes the permission. |

**Are you using remote code?** No. All code is in the package; `importScripts` loads only packaged files.

**Data usage** (what the extension collects). Recommended answers:

- Tick **Authentication information**: the user's OMDb API key is stored in
  synced extension storage and sent to omdbapi.com with each fallback
  request. (Only if the user enters one.)
- Tick **Website content**: the title names read from the streaming site are
  sent to omdbapi.com for fallback lookups, and the IMDb IDs of titles the
  user looks at for the optional extra scores. (Only if the user enables
  OMDb.)
- Leave everything else unticked: no personal info, health, financial,
  communications, location, web history or user activity is collected.
- Tick all three certifications: not sold to third parties; not used for
  purposes unrelated to the single purpose; not used to determine
  creditworthiness or for lending.

**Privacy policy URL:**
https://lwolf12.github.io/show-imdb-ratings/PRIVACY
(GitHub Pages, built from PRIVACY.md on main; a change shows there a minute
or two after the push).

## Distribution tab

Visibility **Public**, all regions, free.

## Things the reviewer may raise

- **Optional hosts in 1.3.0.** Letterboxd and the catch-all
  `https://*/*` are under `optional_host_permissions`, so the update
  shows no warning and disables nothing. The catch-all is requested only
  as the one address the user types on the settings panel (the browser's
  dialog names that host), never as a whole; see the justification table.
  `scripting` registers the content script for a granted address and
  nothing else.
- **New sites in 1.0.0.** Apple TV, Disney+, Paramount+ and Tubi were
  added as ordinary content-script sites, so the install warning now lists them
  too, and existing users are asked once to accept them. The extension
  does the same thing there as on the first four: reads the title names on
  cards and pages and draws the rating badge.

- **Trademark in the name.** "IMDb" is a registered trademark. The name
  uses it descriptively ("Show IMDb Ratings on …") rather than as a brand,
  many "IMDb Ratings for Netflix"-style extensions are listed, and the
  description ends with a non-affiliation notice.
- **amazon.com match.** Content scripts run only on
  `www.amazon.com/gp/video/*`, where Prime Video's storefront and title
  pages live. Prime title pages reached through `/dp/<ASIN>` links (from
  Google or Amazon search) render the same page but get no chip; matching
  `/dp/*` would mean every Amazon product page, which is not worth the
  broader permission.
- **Large download.** Reviewers sometimes ask why an extension pulls 280 MB.
  The description and the settings panel already explain it and nothing
  downloads without a click.
