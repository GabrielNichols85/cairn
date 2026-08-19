# Cairn

*A place to remember what God has done.*

A private prayer wall and journal. Its one distinguishing idea: when a prayer is
answered, Cairn keeps it and brings it back to you later — especially on the
anniversary of the day it was answered.

No ads. No trackers. No feed. Nothing you write is ever shown to anyone else.

---

## What's in it

| | |
|---|---|
| **Prayer wall** | Click any empty spot and start typing. Drag notes around. Drag one onto the ribbon at the bottom to move it to Answered. On a phone the same notes appear in a tidy list with an Answered button, because dragging on a phone is miserable. |
| **Remember** | The top card on the Today screen surfaces an answered prayer from your past — anniversaries first — with how long you waited. |
| **Thankful journal** | Five slots, each with a guiding question pulled from a different corner of life so you don't write "my family" five times. Saves as you type. |
| **Open journal** | A blank page. No prompts. |
| **Daily reading** | The whole New Testament in 260 days, plus a Psalm. The passage text is shown inline so you don't have to leave. One checkbox. |
| **Yours** | Export or delete everything at any time. Installable as a phone app. Light and dark. |

## Running it

There is no build step. It is plain HTML, CSS and ES modules.

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

`dist/cairn-preview.html` is the whole app compiled into one file you can open by
double-clicking. Rebuild it with `node build-preview.mjs`.

## Making it yours

Everything you'd want to change lives in **`config.js`** — app name, Ko-fi link,
email list, and the two Supabase keys. Nothing else needs editing.

## Two modes

Cairn runs happily without any backend at all:

- **Local** (default) — everything saves to the browser. Works offline, instantly,
  no account. This is what you get before Supabase is configured.
- **Cloud** — fill in `supabaseUrl` and `supabaseAnonKey` in `config.js` and the
  same app gains Google sign-in and sync across devices.

The views never know which one is running, so nothing gets rewritten when you
switch. See `DEPLOY.md` for the full setup, and `supabase/schema.sql` for the
database (every table locked with row-level security, so a signed-in person can
only ever reach their own rows).

## Layout

```
index.html            shell
styles.css            all styling; design tokens at the top
config.js             ← the only file you need to edit
src/
  main.js             boot, theme, routing
  store.js            data layer — local and Supabase behind one API
  util.js  ui.js      helpers; toasts, modals, icons
  readings.js         the 260-day plan and passage fetching
  prompts.js          the thankful-journal questions
  views/              today, wall, answered, journal, settings
supabase/schema.sql   tables + row-level security
build-preview.mjs     builds the single-file copy
```

## Credit

Scripture text: the [World English Bible](https://worldenglish.bible/), public
domain, served by [bible-api.com](https://bible-api.com). If it can't be reached,
Cairn shows the reference and a link out instead.
