# Firefox Add-ons listing: Show IMDb Ratings on Streaming Services

Everything to paste into the Firefox add-on developer hub
(<https://addons.mozilla.org/developers/>). The upload ZIP is
`dist/imdb-ratings-v<version>-firefox.zip`, built with
`store/build-zip.ps1` (needs Node for the Firefox manifest).
The Chrome listing is in `LISTING.md`.

## Submitting

1. **Submit a New Add-on → On this site** (listed on addons.mozilla.org).
2. Upload the Firefox ZIP. The validator should show no errors; it warns
   about `offscreen` calls in `build.js`, which are Chrome-only and
   never run in Firefox (see the reviewer notes).
3. Platforms: **Firefox** only. Not Firefox for Android: streaming
   sites send phones to their apps, and the 280 MB database build is a
   poor fit for a phone.
4. **Do you use code generators, minifiers or similar?** No. Only the
   manifest is assembled by a script; see the reviewer notes. (Answering
   No means no source-code upload is needed.)

## Listing

**Name:** Show IMDb Ratings on Streaming Services

**Add-on URL:** `imdb-ratings-on-streaming` (`show-imdb-ratings` was already taken; the limit is 30 characters)

**Summary** (250 characters max):

> Shows the IMDb rating on title cards while you browse Netflix,
> Prime Video, Hulu, HBO Max and more. Ratings are looked up on your own
> device from IMDb's public data, with no tracking.

**Description:**

> See IMDb ratings without leaving the streaming site. Works on Netflix, Prime Video, Disney+ and HBO Max. Hulu, Apple TV, Paramount+ and Tubi are covered too, and so is Letterboxd. While you browse, every title card gets a small rating badge. Hovering a title adds the year and vote count to the site's own preview, with a link to the title's IMDb page. Banners and title pages get a rating chip too. A show's episode list also gets a rating next to every episode, so the standout episodes and seasons are easy to spot. Prefer a cleaner look? Badges come in three sizes, and card badges can show only when the mouse is over a card, or not at all.
>
> HOW IT WORKS
> No account and no key needed. By default the extension builds its own ratings database in your browser from IMDb's public data: about 280 MB and a few minutes, with ratings showing before it has even finished. From then on every lookup happens on your device: instant, unlimited, and without sending the titles you browse to anyone. Each week only the small ratings file (about 9 MB) is re-read; the full title list, which brings in new titles, is rebuilt monthly, and both can be set to run less often, or only when you click, for metered connections.
>
> Nothing downloads until you click Update now in the settings, which open in a small window right after installing. A build can be cancelled at any point and leaves nothing half done. Later, the extension's toolbar button opens them. The settings list every supported site: tick the ones you want ratings on and untick the rest. Another address that uses a supported site's layout, such as a streaming service's site in another country, can be added there too.
>
> OPTIONAL: AN OMDb KEY
> A free key from omdbapi.com (1,000 lookups a day), pasted into the settings, can work with the database or replace it; Firefox asks you before any title names are sent:
>
> Database plus key. Hover previews, banners and title pages add Rotten Tomatoes and Metacritic scores (mostly for films) and awards, and title cards can show the scores too. A title that came out since the last rebuild is looked up at OMDb until the database has it. Only these lookups send title names to OMDb.
>
> OMDb only. Nothing to download or keep up to date: ratings come from OMDb as you browse, within the key's 1,000 lookups a day, and each answer is remembered for 30 days. What you give up: OMDb has no vote counts for episodes, its copy of a rating is not always current, titles in other languages are not matched, badges depend on OMDb's server, and title names are sent to OMDb. With the database alone, lookups never leave your device.
>
> One box, Use OMDb, switches the key off again and keeps it.
>
> OPTIONAL: TITLES IN OTHER LANGUAGES
> A streaming site in another language shows translated titles, which the database knows only by their English and original names. Tick Match titles in other languages in the settings, tick the languages you use (from Polish to Korean, Japanese and Chinese), and click Get titles: the extension reads IMDb's list of titles by country once (520 MB, nothing saved as a file) and keeps the useful part, about 50 MB, in the database. Ticking another language later takes seconds. Not needed with an English browser on English pages.
>
> PRIVACY
> No accounts, no analytics, no server. The extension reads only the title names on the cards it decorates and sends nothing about you anywhere. Full policy: https://lwolf12.github.io/show-imdb-ratings/PRIVACY
>
> OPEN SOURCE
> https://github.com/Lwolf12/show-imdb-ratings
>
> Independent project, not affiliated with or endorsed by IMDb or any streaming service.

The same keyword rule as the Chrome listing applies (see LISTING.md): no
lists of brand names beyond four.

**Categories:** Photos, Music & Videos (and, if a second is allowed,
Other).

**Tags:** fixed list on AMO; only `streaming` fits

**Support website:** https://github.com/Lwolf12/show-imdb-ratings/issues/new/choose (lands on the issue-form chooser, not the empty issue list)

**Homepage:** https://github.com/Lwolf12/show-imdb-ratings

**License:** MIT (the repository's LICENSE file, added 2026-10-26).

**Privacy policy:** paste the text of `PRIVACY.md` (the form
takes text, not a link).

**Screenshots:** the Chrome ones work (Firefox looks the same on these
sites); 1280×800 PNG.

## Notes to reviewer

> The ratings database is built in the browser from IMDb's public datasets
> (datasets.imdbws.com), only after the user clicks Update now on the
> settings page, and stored in IndexedDB (hence unlimitedStorage). It runs
> in a web worker inside offscreen.html, which in Firefox is a hidden
> iframe in the background event page. The offscreen.* calls in
> build.js are behind a check for Firefox and only run in Chrome.
>
> OMDb (www.omdbapi.com) is optional: it is used only after the user enters
> their own API key, and in Firefox only after they grant the optional
> "websiteContent" data-collection permission, which the settings page
> requests when OMDb is turned on.
>
> Since 1.3.0 the manifest lists letterboxd.com and https://*/* among the
> host permissions (optional in Firefox, like all of them). Letterboxd is
> off until the user ticks it on the settings page, which asks for that
> one host. The https://*/* entry exists so the user can add an address of
> their own under one of the known sites (a country's Amazon store, say):
> the page asks Firefox for exactly the address typed, inside the click,
> and background.js then registers the content script for that address
> with scripting.registerContentScripts. The extension never requests all
> sites, and nothing runs on a site the user did not tick or add.
>
> No code is minified or transpiled. The manifest is generated from the
> Chrome manifest by store/firefox-manifest.mjs in the public
> repository (https://github.com/Lwolf12/show-imdb-ratings); all other files are
> exactly as in the repository.
>
> To test: install, click Update now in the settings window (a few
> minutes), then open https://tubitv.com/ or https://tv.apple.com/, which
> work without an account; title cards get IMDb rating badges.
