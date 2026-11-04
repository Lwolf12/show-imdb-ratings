**What's new in 1.2.3**

- Netflix in Chinese or Japanese: the home banner gets its rating. Those profiles write the banner's label with a full-width colon and no space ("精選內容：現代驅魔師"), which the title parser did not split, so the banner said no match whatever the title; it now does, and a banner named in another script gets its English name looked up first, as the cards do.

Download the ZIP, extract it, then in Chrome open chrome://extensions, turn on Developer mode, click **Load unpacked** and pick the `show-imdb-ratings` folder. Details in the [README](https://github.com/Lwolf12/show-imdb-ratings#readme).
