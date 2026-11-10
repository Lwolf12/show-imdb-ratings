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

> Free and open source. Shows the IMDb rating on title cards while you
> browse Netflix, Prime Video, Hulu, HBO Max and more. Ratings are looked up
> on your own device from IMDb's public data, with no tracking.

**Description:**

> See IMDb ratings without leaving the streaming site. Works on Netflix, Prime Video, Disney+ and HBO Max. Hulu, Apple TV, Paramount+ and Tubi are covered too, and so is Letterboxd.
>
> While you browse, every title card gets an optional small rating badge. In settings you choose whether to always show, show only on hover, or not at all. Hovering a title adds the year and vote count to the site's own preview, with a link to the title's IMDb page. Banners and title pages get a rating chip too. A show's episode list also gets a rating next to the episodes. Badges come in three sizes.
>
> HOW IT WORKS
> Local database option: the settings default to a local database for the IMDb ratings. With this option, the extension builds its own ratings database in your browser from IMDb's public data: about 280 MB and a few minutes. From then on lookups happen on your device. The database can optionally be refreshed automatically, with a small download each week and a bigger one each month, and/or it can be refreshed manually by clicking Update now in the settings.
>
> OMDb option: a free key from omdbapi.com (1,000 lookups a day), pasted into the settings, can work with the local database or replace it; Firefox asks you before anything is sent to OMDb. The OMDb option also allows Rotten Tomatoes, Metacritic and awards to be optionally shown with the IMDb rating.
>
> If OMDb only is selected, there's nothing to download or keep up to date: ratings come from OMDb as you browse, within the key's 1,000 lookups a day. Each answer is remembered for 30 days, minimizing the number of lookups required.
>
> Without the local database (OMDb only option), titles in other languages are not matched. Ratings can be missing for some shows, and ratings may be older and not match the current IMDb rating.
>
> With the local database only (Use OMDb not checked), lookups don't leave your device. However, Rotten Tomatoes, Metacritic and awards will not appear (they come from OMDb).
>
> The settings list every supported site: tick the ones you want ratings on and untick the rest. Another address that uses a supported site's layout, such as a streaming service's site in another country, can be added there too.
>
> OPTIONAL: TITLES IN OTHER LANGUAGES
> On a streaming site in another language, the extension can look up IMDb ratings by the titles shown in that language: tick Match titles in other languages in the settings, pick your languages (from Polish to Korean, Japanese and Chinese) and click Get titles, a one-time download of about 520 MB (about 40 MB of it is kept). Not needed on English pages.
>
> PRIVACY
> No accounts, no analytics, no server. The extension reads only the title names on the cards it decorates and sends nothing about you anywhere. Full policy: https://lwolf12.github.io/show-imdb-ratings/PRIVACY
>
> FREE AND OPEN SOURCE
> https://github.com/Lwolf12/show-imdb-ratings
>
> Independent project, not affiliated with or endorsed by IMDb or any streaming service.

The same keyword rule as the Chrome listing applies (see LISTING.md): no
lists of brand names beyond four.

**Categories:** Photos, Music & Videos (and, if a second is allowed,
Other).

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
