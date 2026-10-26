# Releasing

Each version is published as a GitHub Release with a ZIP attached, so
downloads are counted. A workflow (`.github/workflows/release.yml`) does the
work when a tag is pushed. The store ZIPs are separate: see
`store/build-zip.ps1` and `store/LISTING.md`.

Releases up to 1.0.0 were made while the extension lived in the
`imdb-ratings` folder of <https://github.com/Lwolf12/chromeext>, and their
ZIPs stay on that repository's Releases page. The history and the version
tags (`v0.4.0` to `v1.0.0`) came along.

## Cut a release

1. Bump `"version"` in `manifest.json` and commit it.
2. Tag the commit `v<version>` and push the tag:

   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

   The tag's version must match the manifest, or the workflow stops.
3. A minute later the release appears at
   <https://github.com/Lwolf12/show-imdb-ratings/releases> with
   `show-imdb-ratings-v1.0.1.zip` attached. The ZIP never includes `data/`:
   that database is built by each user from IMDb's dumps, which IMDb
   licenses for personal use only, so it must not be redistributed.
4. Add a short "What's new" to that release's notes, above the install
   text the workflow wrote: a few bullets covering this release only, never
   a running history (older notes stay on older releases).

   ```bash
   gh release edit v1.0.1 --notes-file notes.md
   ```

   where `notes.md` holds the What's new bullets followed by the existing
   install text (`gh release view v1.0.1 --json body`).

## Download counts

```bash
gh api repos/Lwolf12/show-imdb-ratings/releases --paginate \
  --jq '.[] | "\(.tag_name)\t\([.assets[].download_count] | add // 0)"'
```

The older releases are counted the same way on `repos/Lwolf12/chromeext`.
Views, unique visitors and clones are under **Insights → Traffic** on GitHub
(last 14 days only).
