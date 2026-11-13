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

**Name:** IMDb Ratings: Netflix, Prime, Hulu, HBO Max & more

Two names, two limits. The listing's Name field (Edit Product Page >
Describe Add-on > Edit) takes 50 characters and is what AMO search reads;
since 2026-11-12 it holds the line above (exactly 50; the colon instead of
"on" makes room for HBO Max). AMO never copies a package name to it, so it
is changed by hand. The package name (store/firefox-manifest.mjs, shown in
Firefox's own add-ons list) is limited to 45 by AMO's upload check (47 was
refused) and stays "IMDb Ratings on Netflix, Prime, Hulu & others".

**Add-on URL:** `imdb-ratings-on-streaming` (`show-imdb-ratings` was already taken; the limit is 30 characters)

**Summary** (250 characters max):

> Free and open source. Shows the IMDb rating on title cards while you
> browse Netflix, Prime Video, Hulu, HBO Max, Disney+, Apple TV, Paramount+
> and Tubi. Also shows IMDb ratings on Letterboxd titles. Looked up on your
> own device, with no tracking.

Since 2026-11-12 (edited in the dashboard, no package needed): all eight
services, Letterboxd in a sentence of its own. 246 characters.

**Description:**

> See IMDb ratings without leaving your streaming site.
>
> Works on Netflix, Prime Video, Hulu, HBO Max, Disney+, Apple TV, Paramount+ and Tubi. Also shows IMDb ratings on Letterboxd titles.
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
> A free API key from omdbapi.com provides up to 1,000 lookups per day. Enter the key in settings to use OMDb alongside the local database or instead of it. Firefox asks you before anything is sent to OMDb.
>
> OMDb also lets you optionally display Rotten Tomatoes scores, Metacritic scores and awards alongside IMDb ratings.
>
> If you use OMDb alone, there's no database to download or maintain. Ratings are retrieved as you browse, and results are cached for 30 days to minimize requests and stay within the daily lookup limit.
>
> The main disadvantage of using OMDb alone is that titles in other languages aren't matched, and lookups are limited to 1,000 a day.
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

Chrome's keyword rule (see LISTING.md: no list of more than four brand
names) is Chrome's alone. AMO has taken all eight in one list since
2026-11-12 (Larry's choice: its search reads the summary and description),
after approving the two-sentence version in three releases.

**Categories:** Photos, Music & Videos; Games & Entertainment (added
2026-11-12; up to three allowed).

**Tags:** fixed list on AMO; only `streaming` fits

**Support website:** https://lwolf12.github.io/show-imdb-ratings/ (since 2026-11-08; github.com repo pages were timing out for signed-out visitors that day)

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
