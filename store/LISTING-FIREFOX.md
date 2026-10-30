# Firefox Add-ons listing: Show IMDb Ratings on Streaming Services

Everything to paste into the Firefox add-on developer hub
(<https://addons.mozilla.org/developers/>). The upload ZIP is
`dist/imdb-ratings-v<version>-firefox.zip`, built with
`store/build-zip.ps1` (needs Node for the Firefox manifest).
The Chrome listing is in `LISTING.md`.

## Submitting

1. **Submit a New Add-on → On this site** (listed on addons.mozilla.org).
2. Upload the Firefox ZIP. The validator should show no errors; it warns
   about `offscreen` calls in `background.js`, which are Chrome-only and
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

> Shows the IMDb user rating on title cards while you browse Netflix,
> Prime Video, Hulu, HBO Max and more. Ratings are looked up on your own
> device from IMDb's public data, with no tracking.

**Description:**

> See IMDb ratings without leaving the streaming site. Works on eight of
> the major streaming services (the full list is on the project page
> below). While you browse, every title card gets a small rating badge.
> Hovering a title adds the year and vote count to the site's own preview,
> with a link to the title's page. Banners and title pages get a rating
> chip too. A show's episode list also gets a rating next to every episode,
> so the standout episodes and seasons are easy to spot. Prefer a cleaner
> look? Card badges can show only when the mouse is over a card, or not at
> all.
>
> HOW IT WORKS
> Two ways to get ratings, chosen in the settings:
>
> Local database (default). Built once in your browser from IMDb's public
> data, about 280 MB and a few minutes, with ratings showing before it has
> even finished. From then on every lookup happens on your device: instant,
> unlimited, and without sending the titles you browse to anyone. Each week
> only the small ratings file (about 9 MB) is re-read; the full title list
> is rebuilt monthly, and both can be set to run less often, or only when
> you click, for metered connections.
>
> OMDb only. No database. With a free key from omdbapi.com, every title is
> looked up at OMDb as you browse. Nothing to build, but 1,000 lookups a
> day, badges that fill in a moment after the page shows, and the titles
> you browse are sent to OMDb (Firefox asks you first).
>
> Nothing downloads until you click Update now in the settings, which open
> in a small window right after installing. Later, the extension's toolbar
> button opens them. Every service is on from the start; any of them can
> be switched off in the settings if you'd rather not see ratings there.
>
> OPTIONAL: NEW RELEASES
> Brand-new titles are not in the public data yet. To cover those, get a
> free API key from omdbapi.com (1,000 lookups a day) and paste it into the
> settings. Firefox then asks you to allow sending title names to that
> service, and only titles the local database does not have are sent.
> With a key, previews and title pages can also show Rotten Tomatoes and
> Metacritic scores and awards.
>
> PRIVACY
> No accounts, no analytics, no server. The extension reads only the title
> names on the cards it decorates and sends nothing about you anywhere.
> Full policy: https://github.com/Lwolf12/show-imdb-ratings/blob/main/PRIVACY.md
>
> OPEN SOURCE
> https://github.com/Lwolf12/show-imdb-ratings
>
> Independent project, not affiliated with or endorsed by IMDb or any
> streaming service.

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
> background.js are behind a check for Firefox and only run in Chrome.
>
> OMDb (www.omdbapi.com) is optional: it is used only after the user enters
> their own API key, and in Firefox only after they grant the optional
> "websiteContent" data-collection permission, which the settings page
> requests when OMDb is turned on.
>
> No code is minified or transpiled. The manifest is generated from the
> Chrome manifest by store/firefox-manifest.mjs in the public
> repository (https://github.com/Lwolf12/show-imdb-ratings); all other files are
> exactly as in the repository.
>
> To test: install, click Update now in the settings window (a few
> minutes), then open https://tubitv.com/ or https://tv.apple.com/, which
> work without an account; title cards get IMDb rating badges.
