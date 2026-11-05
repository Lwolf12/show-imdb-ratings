**What's new in 1.2.4**

- Match titles in other languages, switched off: the keys stayed for turning it back on, but the six-hourly check could still remove them, and the settings page said "Next: titles in no other language" meanwhile. Off now means off; nothing runs until the box is on again.
- Settings page: the message at the top right no longer pushes the page down when it runs to two lines; the "On cards too" row stays on one line without an OMDb key, so the footer stays in view; and a full build with a language ticked no longer runs the status line to three lines in its last phase.
- Under the hood: the background is six files instead of one and the settings page three, the languages section keeps its state in one place, and a new test harness runs the background and the settings page together in node, with tests for the language flows. No change in what the extension does.

Download the ZIP, extract it, then in Chrome open chrome://extensions, turn on Developer mode, click **Load unpacked** and pick the `show-imdb-ratings` folder. Details in the [README](https://github.com/Lwolf12/show-imdb-ratings#readme).
