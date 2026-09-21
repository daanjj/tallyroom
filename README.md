# Tally Room

Live polling for workshops. `index.html` is the whole app (served via GitHub Pages); `tallyroom.html` is the same file kept as the editable source. See `tallyroom-setup.md` for setup and usage.

## Question types

Two kinds of question, mixable in one session:

- **Numeric scale**: `{"text": "…", "min": 1, "max": 5, "lo": "Strongly disagree", "hi": "Strongly agree"}`. Shows mean, median and spread.
- **Named options** (added 21 Sep 2026): `{"text": "…", "options": ["Gert", "Domein-MT", "…"]}`. Two to eleven options. Participants tap a labelled button; the presenter sees per-option counts, the most chosen option (ties are shown) and how many different options were chosen. No mean or median, since the options have no order.

In the editor each question has a field "Named options, one per line"; leave it empty for a numeric scale. Import / export as JSON accepts both shapes. Votes are stored as the option's position (1 = first option), so reordering options after people answered changes what their answers mean.

`20260921-tallyroom-top10-besluiten.json` holds the 20 questions (wie + hoe for the ten most polarising decisions) for the CMC offsite.
