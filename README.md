# Tally Room

Live polling for workshops, served as a static site (GitHub Pages) with a free Firebase database. One installation holds any number of **question sets**; each set has its own link, QR code, header, accent colour and expiry date, so several teams can use it at the same time. See `tallyroom-setup.md` for setup and usage, and `BACKLOG.md` for what is planned.

## Files

There is no build step: the browser loads these files as they are.

| File | What it holds |
|---|---|
| `index.html` | The page shell: it only loads the files below |
| `config.js` | Your settings: Firebase project, host key |
| `css/styles.css` | All styling. The purple values are the default accent |
| `js/core.js` | Pure logic: questions, statistics, exports, expiry, colour palette. No screen, no network |
| `js/backend.js` | Where the data lives: Firebase, or a demo store inside the browser |
| `js/app.js` | Screens and actions |
| `tests/core.test.js` | Tests for `js/core.js` |

## Trying it without touching the database

Add `?demo=1` to the address. The page then keeps its data in this browser only (shared between its tabs), you are the presenter, and eight simulated participants answer. `&host=off` shows what a participant sees.

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765/?demo=1`.

## Tests

```bash
node --test
```

Needs Node 18 or newer, nothing to install.

## Data layout

- `sets/{setId}`: the attributes of a set (`name`, `header`, `accent`, `category`, `named`, `expiresAt`, `joinUrl`, `createdAt`, `updatedAt`). This is the list the presenter's overview shows.
- `polls/{setId}/config`: mode, follow-up prompts and the questions.
- `polls/{setId}/session`: where the session stands (phase, current question, round).
- `polls/{setId}/votes/{deviceId}`: one record per device, so a phone counts once per set.

## Question types

Three kinds of question, mixable in one set:

- **Numeric scale**: `{"text": "…", "min": 1, "max": 5, "lo": "Strongly disagree", "hi": "Strongly agree"}`. Shows mean, median and spread.
- **Named options**: `{"text": "…", "options": ["Alex", "Team", "…"]}`. Two to eleven options. Participants tap a labelled button; the presenter sees per-option counts, the most chosen option (ties are shown) and how many different options were chosen. No mean or median, since the options have no order.
- **Traffic light**: `{"text": "…", "kind": "traffic", "options": ["Consent", "Zorg", "Bezwaar"]}`. Green, yellow, red; yellow and red require a written follow-up answer.

In the editor each question has a field "Named options, one per line"; leave it empty for a numeric scale. Import / export as JSON accepts all shapes. Votes are stored as the option's position (1 = first option), so reordering options after people answered changes what their answers mean.

A questions file exported from the overview also carries a `set` block (`name`, `header`, `accent`, `category`, `named`); "New question set → Create from file" reads it back.

