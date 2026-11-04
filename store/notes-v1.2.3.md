**What's new in 1.2.3**

- Netflix in Chinese or Japanese: the home banner gets its rating. Those profiles write the banner's label with a full-width colon and no space ("精選內容：現代驅魔師"), which the title parser did not split, so the banner said no match whatever the title; it now does, and a banner named in another script gets its English name looked up first, as the cards do.
- Netflix episode lists in Chinese, Japanese, Korean, Thai, Russian, Greek, Hindi, Arabic or Hebrew: the per-episode ratings are back. The adapter only knew the European words for season, episode and part, so a show page in those languages was not recognised as one; it now knows the local words, with the number before or after the word, and tries the show's English name as well as the local one.
- Prime Video: episode ratings are back on series pages. Prime's new episode grid lays each heading out twice and shows the second copy; the rating went into the hidden one.
- Episode ratings sit in a faint chip like the one under the show, instead of a black pill on every row.

Download the ZIP, extract it, then in Chrome open chrome://extensions, turn on Developer mode, click **Load unpacked** and pick the `show-imdb-ratings` folder. Details in the [README](https://github.com/Lwolf12/show-imdb-ratings#readme).
