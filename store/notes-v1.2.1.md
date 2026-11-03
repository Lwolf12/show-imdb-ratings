**What's new in 1.2.1**

Small fixes, nothing to set up:

- Netflix: a show whose name begins a longer episode name ("Dark", "Darkness Falls") no longer loses its own preview rating.
- Titles in other languages: a title's own language now decides where it belongs, so Catalan titles no longer feed the Spanish list nor English titles in Canada the French one; Norwegian is listed once (Bokmål and Nynorsk count as Norwegian).
- Turning the languages off without a database no longer creates an empty one.
- The settings page asks the browser for the disk figure once a minute instead of on every click.
- A build can no longer be started twice at the same moment (the scheduled refresh and Update now together).
- Lookups of translated titles use one database transaction instead of two.

Download the ZIP, extract it, then in Chrome open chrome://extensions, turn on Developer mode, click **Load unpacked** and pick the `show-imdb-ratings` folder. Details in the [README](https://github.com/Lwolf12/show-imdb-ratings#readme).
