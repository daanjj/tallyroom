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

## Categories and question types

Each set has a category, which decides which question types its editor offers and what "+ Add question" creates:

| Category | Question types | "+ Add question" gives |
|---|---|---|
| Generic | scale, multiple choice, open | scale |
| Consent | the generic types + traffic light | traffic light |
| Dilemma | the generic types + dilemma | dilemma |

Imports (JSON, CSV, "Create from file") skip questions of a type the category does not offer and say how many. A set can only change category when all its questions fit the new one.

The question types, as they appear in the JSON import / export:

- **Scale**: `{"text": "…", "min": 1, "max": 5, "lo": "Strongly disagree", "hi": "Strongly agree"}`. Shows mean, median and spread.
- **Multiple choice**: `{"text": "…", "options": ["Alex", "Team", "…"]}`. Two to eleven options. The presenter sees per-option counts, the most chosen option (ties are shown) and how many different options were chosen. No mean or median, since the options have no order.
- **Open**: `{"text": "…", "kind": "open", "maxLen": 500}`. One text box and a Submit button; the presenter sees the number of answers before the reveal and the list of answers after it.
- **Traffic light** (consent sets): `{"text": "…", "kind": "traffic", "options": ["Consent", "Zorg", "Bezwaar"]}`. Green, yellow, red; yellow and red require a written follow-up answer.
- **Dilemma** (dilemma sets): `{"text": "…", "kind": "dilemma", "options": ["Build", "Buy"], "conf": {"text": "How confident are you in your choice?", "min": 1, "max": 5, "lo": "Not at all", "hi": "Very"}}`. A choice plus a confidence rating, sent together. The presenter sees per option the count, the share and the mean confidence, with the confidence distribution inside each bar.

Votes are stored as the option's position (1 = first option), so reordering options after people answered changes what their answers mean. An open answer is stored as text; a dilemma answer as the option's position plus the confidence value.

A questions file exported from the overview also carries a `set` block (`name`, `header`, `accent`, `category`, `named`); "New question set → Create from file" reads it back.

