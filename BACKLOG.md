# Tally Room backlog

Written 20 Nov 2026 against `index.html` at commit `60459c6`.

## How to read this

- Items are grouped in epics A to F (E is parked for later). IDs are stable (`A1`, `B3`, …) so they can be referenced in commits.
- Each item has: a user story, the specification, acceptance criteria (AC), dependencies and a rough size (S = up to half a day, M = about a day, L = several days).
- **Assumption** marks a choice I made where your description left room. They are collected again in [Open decisions](#open-decisions); check those before starting the item.
- "Set" means question set. "Presenter" is the device that opened the page with `?host=…`.

## Language

- The user interface is always English: buttons, screens, messages, export column names and the fixed headings of the Markdown export. No item in epics A to D adds translation of the interface.
- Content is whatever language the presenter types: the header, question texts, option labels, scale labels, the traffic light labels and follow-up prompts, and the confidence question of a dilemma. The app never assumes a language for content.
- Consequence for defaults: text the app fills in for new questions is English (traffic light labels "Consent", "Concern", "Objection"; the follow-up prompts; the dilemma confidence question). The presenter can overwrite each of them per set. Existing sets and imported files keep their own labels, such as "Consent / Zorg / Bezwaar".
- Later, a participant may get a language choice that loads the question texts in that language. That is parked as [E1](#epic-e-later-multiple-languages-for-question-texts). To keep it cheap, items A to D follow one rule: **every content text is read through one helper** (for example `tx(value)`), never straight from the field. Today the helper returns the string; E1 changes only the helper and the editor.

## Where the app stands today (relevant for this backlog)

- One file, `index.html`. No build step. Firebase Realtime Database as backend, with a demo backend when no Firebase config is present.
- Exactly one poll at a time: `POLL_ID` is a constant in the file (now `workshop-4`). Data lives at `polls/{POLL_ID}/config`, `/session`, `/votes`.
- `config` = `{title, mode, joinUrl, tlYellow, tlRed, questions[]}`. `session` = `{phase, current, revealed[], round, showLive, resetAt}`. A vote doc = `{round, answers{qid: number}, texts{qid: string}, t}`, keyed by a per-device id from `localStorage`.
- Question kinds: numeric scale (Likert), named options (multiple choice) and `traffic` (Consent / Zorg / Bezwaar, with a required follow-up text on yellow and red).
- Presenter rights: `?host=HOST_KEY` sets `tr_host_{POLL_ID}` in `localStorage`.
- The accent colour is the CSS variable `--accent` plus derived values (`--accent-soft`, `--accent-ink`, the ramp `--r1`…`--r10`), each defined three times (light, dark by media query, dark by attribute).
- Database rules only allow reading and writing below `polls/{id}`; the list of polls itself cannot be read.

## Suggested order

| Step | Items | Why here |
|---|---|---|
| 1 | A1, A2, A3 | Foundation: everything else hangs on "a set is a record with attributes" |
| 2 | A4, A5, A6 | Makes multiple sets usable in practice |
| 3 | A7, A8 | Expiry and maintenance |
| 4 | B1, B2 | Categories and the open question |
| 5 | D1, D2 | Named respondents; small, and the consent overviews benefit from names |
| 6 | C1, C2, C3, C4 | Consent workflow |
| 7 | B3 | Dilemma question |
| 8 | F1, F2 | Follow-up actions for concerns and objections; builds on the closing overview |

---

## Epic A: multiple question sets

> **Status: built on 20 Nov 2026**, tried in demo mode (`?demo=1`); not yet run against the live Firebase database. Before going live: add the `sets` block to the database rules (`tallyroom-setup.md`, step 1.3).
>
> Differences from the specification below:
> - **Category** was a label only until B1 was built (see Epic B).
> - **Named respondents** had no field in the dialogs until D1 was built (see Epic D).
> - The accent palette is calculated in `js/core.js` (`themeVars`) instead of with CSS `color-mix` / `oklch(from …)`, so it can be tested and the contrast can be guaranteed. Text in the accent colour uses a separate variable `--accent-text`, so a light accent such as yellow stays readable.
> - Migration takes the old poll id from `MIGRATE_POLL_ID` in `config.js` (now `workshop-4`), and the migrated set keeps that id instead of getting an 8-character one, so its data stays where it is.
> - An expired set is read-only for the presenter in this sense: paging through results works on the presenter's screen only and is not sent to the room; starting, clearing, resetting and editing questions are refused until the set is extended.

### A1. Data model and routing for multiple sets — L

**Story.** As a presenter I want several question sets to exist next to each other, so that the app can run in different team settings in parallel.

**Specification**

- The set is chosen by the URL: `?set={setId}`. `POLL_ID` as a constant disappears.
- `setId`: 8 random characters from `a-z0-9`, generated on creation, never changes (the QR code depends on it).
- Storage:
  - `sets/{setId}` = the set's attributes (the "meta" record): `{name, header, accent, category, named, expiresAt, createdAt, updatedAt}`. This node is the index for the overview in A2, so it stays small.
  - `polls/{setId}/config|session|votes` = unchanged from today.
- `config.title` moves to `sets/{setId}/header` (see A4). `config` keeps `mode`, `tlYellow`, `tlRed`, `questions`.
- All code that uses `POLL_ID` (Firebase ref, REST fallback URL, export file names, `localStorage` keys) takes the current set id instead.
- Presenter flag becomes global: `?host=HOST_KEY` sets `tr_host`, valid for all sets on that device. `?host=off` removes it.
- URL without `?set=`: the presenter gets the set overview (A2); a participant gets a neutral page "Scan the QR code or open the link you received".
- URL with an unknown `setId`: "This question set does not exist (any more)".
- Database rules get a second block for `sets` (read and write open, like `polls`). Update `tallyroom-setup.md` section 1.3 and section 2 (no more `POLL_ID`).
- Migration: on first presenter visit, if `sets` is empty and `polls/workshop-4` exists, create a meta record for it (name "workshop-4", header from `config.title`, default accent, category `consent`, `named: "no"`, expiry now + 3 days). Older polls (`workshop-3` and earlier) are not migrated.
- The demo backend keeps working with one in-memory set.

**AC**

- Two sets opened in two browser windows run completely independently: questions, phase, votes, joined count.
- A participant who has both links open on one phone counts once in each set.
- Existing `workshop-4` data is reachable after the migration.
- The REST fallback and the reconnect logic still work per set.

**Depends on:** nothing.

### A2. Set overview (presenter home) — M

**Story.** As a presenter I want one screen with all my sets, so that I can open, create and maintain them.

**Specification**

- Shown to the presenter when there is no `?set=` in the URL, and reachable from the lobby through a link "All question sets" in the top bar.
- One row or card per set with: accent colour swatch, name, header, category, number of questions, number of respondents in the current round, phase (lobby / running / finished), expiry status (A7).
- Sort order: active sets first, most recently updated on top; expired sets below.
- Clicking a set opens `?set={id}` in the presenter view.
- A menu per set with the maintenance actions from A8.
- Counts of questions and respondents are read per set on demand (one REST read per set), not kept in the index.

**AC**

- The overview shows all sets from `sets/`, updates live when a set is created or deleted on another device.
- A non-presenter never sees the overview.

**Depends on:** A1.

### A3. Create a set — S

**Story.** As a presenter I want to create a new set with its attributes in one dialog.

**Specification**

- Button "New question set" in the overview.
- Dialog fields: name (required, internal label for the overview), header (default = name), accent colour (default purple `#5A3BD6`), category (default `generic`, see B1), named respondents (default `no`, see D1), expiry (default 3 days from now, see A7).
- On save: write `sets/{id}`, write `polls/{id}/config` with an empty question list and `polls/{id}/session` with `DEFAULT_SESSION`, then open the set in the question editor.
- The hard-coded Dutch questions in `DEFAULT_CONFIG` are removed; a new set starts empty.

**AC**

- A new set appears in the overview, has its own link and QR code, and opens with zero questions.
- Creating a set never touches other sets.

**Depends on:** A1, A2.

### A4. Configurable header per set — S

**Story.** As a presenter I want each set to show its own header, so that the audience sees a title that fits their session.

**Specification**

- `sets/{id}/header`, free text, max 80 characters.
- Shown in the top bar on presenter and participant screens (where `config.title` is shown now) and used as `document.title`.
- Editable in the set settings (A8). A change is live on all devices without a reload.

**AC**

- Two sets show different headers at the same time.
- Changing the header during a running session updates every connected device.

**Depends on:** A1.

### A5. Configurable accent colour per set — M

**Story.** As a presenter I want to pick an accent colour per set, so that the styling fits the audience.

**Specification**

- `sets/{id}/accent`, a hex colour. The settings dialog offers 8 presets (current purple first) plus a free colour picker.
- All accent-dependent variables are derived from this one value at runtime and set on `:root`: `--accent`, `--accent-soft`, `--accent-ink` (black or white, whichever has the higher contrast with the accent) and the ramp `--r1`…`--r10` (via `color-mix` with the surface colour, light to dark in light mode and reversed in dark mode).
- In dark mode the accent is lightened so that it keeps a contrast ratio of at least 4.5:1 against the surface.
- Everything that is purple today follows the accent, in two groups:
  - **Strong purple**: primary buttons, the selected mode button, the logo mark in the top bar, question numbers, progress bars, chart bars, the pulse on waiting screens, focus rings. These use `--accent` and the ramp, so they follow directly.
  - **Faint purple tints**: the lilac page background (`--bg`), panel and hover backgrounds (`--surface-2`), borders (`--line`, `--line-2`) and the purple-tinted text colours (`--ink`, `--ink-2`, `--muted`). These are derived from the accent's hue at the same lightness and low saturation they have now (for example with `oklch(from var(--accent) …)`), so an orange set gets a warm off-white page and a green set a cool one, with no purple left.
- Cards stay white (`--surface`) and body text stays near-black in every accent.
- The traffic light colours (green, yellow, red) never change with the accent.
- The QR code keeps dark ink on white, regardless of accent (scan reliability).

**AC**

- Changing the accent recolours buttons, the logo mark, progress bars, chart bars and focus rings on presenter and participant devices without a reload.
- With the accent set to orange or green, no purple is visible anywhere on the lobby, voting, result and summary screens, in light and dark mode (the traffic light colours excepted).
- With each preset, text on primary buttons has a contrast ratio of at least 4.5:1 in light and dark mode.
- A set without `accent` renders exactly as the app does today.

**Depends on:** A1.

### A6. QR code and join link per set — S

**Story.** As a presenter I want each set to have its own QR code, so that each team lands in the right set.

**Specification**

- Join URL = page URL + `?set={id}`; the `host` parameter is never part of it.
- The lobby shows the QR code and link of the current set (as now).
- The overview (A2) gets an action "Show QR" per set: a large QR code plus link with "Copy link" and "Download PNG" (file name `tallyroom-{name}-qr.png`).
- `config.joinUrl` (manual override) moves to the set settings and stays optional.
- The QR cache is keyed by URL (already the case), so switching sets does not show a stale code.

**AC**

- Scanning the QR code of set X always opens set X as a participant, also on a device that has a presenter flag for another reason (the presenter flag still gives the presenter view; "Preview as participant" stays available).
- The downloaded PNG scans correctly when printed at 3 × 3 cm.

**Depends on:** A1.

### A7. Expiry date per set, with easy extension — M

**Story.** As a presenter I want sets to expire, so that old links stop collecting answers, and I want to extend an expired set with one click.

**Specification**

- `sets/{id}/expiresAt` (timestamp). Default on creation: now + 3 days. The settings dialog offers a date and time field plus quick choices: 1 day, 3 days, 1 week, 1 month.
- A set is expired when `now > expiresAt`. Expiry is checked on load and then every minute, on every device.
- Expired, participant: a screen "This question set has expired" with the header; no voting, no heartbeat, no writes.
- Expired, presenter: the set opens read-only (results and exports work) with a banner "Expired on {date}" and a button **Extend 3 days**.
- Overview: expired sets carry an "Expired" badge and a one-click **Extend** button (new expiry = now + 3 days) plus "Other date…". Sets that expire within 24 hours carry "Expires in {n} h".
- Extending is live: participants still on the expired screen return to the session without reloading.
- Expiry never deletes data. Deleting is a separate, manual action (A8).
- **Assumption:** expiry is enforced in the app, not in the database rules. Someone with technical skill could still write to an expired set. That matches the current trust level (open rules, shared host key).

**AC**

- A set with `expiresAt` in the past shows the expired screen on a participant phone and the banner on the presenter laptop.
- One click on **Extend** in the overview makes the set usable again on all devices within a few seconds.
- A set that expires while a session is running: participants see the expired screen within a minute; answers already given are kept.

**Depends on:** A1, A2.

### A8. Maintenance per set — L

**Story.** As a presenter I want to do basic maintenance per set from the overview.

All actions sit in the menu per set in the overview (A2). Settings are also reachable from the lobby of the set.

**A8a. Change attributes.** One "Settings" dialog with: name, header (A4), accent (A5), expiry (A7), category (B1), named respondents (D1), join URL override (A6). Saving writes `sets/{id}` and updates `updatedAt`.

**A8b. Duplicate.** Creates a new set with a new id, name "{name} (copy)", the same header, accent, category, named setting, follow-up prompts and questions (with new question ids). No votes, session in lobby, round 1, expiry = now + 3 days.

**A8c. Delete.** Confirmation dialog that names the set and the number of respondents, and offers "Export responses first". On confirm: remove `sets/{id}` and `polls/{id}`. Devices still connected show "This question set does not exist (any more)".

**A8d. Export questions.** Downloads `tallyroom-{name}-questions.json` in the existing import format (`{followUps, questions[]}`), extended with a `set` block (`header`, `accent`, `category`, `named`). The existing importer ignores unknown keys, and the importer in "New question set" can read the `set` block ("Create from file").

**A8e. Export responses.** The existing JSON and CSV exports, available from the overview without opening the set. Both get the set name, header and category in the payload; file name `tallyroom-{name}-{stamp}.json|csv`. With named respondents (D1) the respondent column holds the name instead of `R01`.

**AC**

- Each of the five actions works from the overview on a set that is not open anywhere.
- A duplicate is fully independent: editing its questions does not change the original.
- After delete, nothing of the set remains in the database.
- A questions export can be imported into a new set and gives identical questions and set attributes.

**Depends on:** A1, A2; A8a also on A4, A5, A7.

---

## Epic B: categories

> **Status: built on 20 Nov 2026**, tried in demo mode (`?demo=1`); not yet run against the live Firebase database.
>
> Differences from the specification below:
> - **Sets from before B1** that hold a question type their category does not offer (for example a Generic set with a traffic light question) keep working; that type stays selectable for those questions only, and no new ones can be added.
> - **Editor:** each question has a "Type" list instead of the old traffic light checkbox and the "leave options empty for a scale" rule. "+ Add traffic-light row" is gone; in a consent set "+ Add question" does that.
> - **Dilemma answers in the JSON export:** a respondent's choice stays in `answers[questionId]` and the confidence is in a separate `confidence[questionId]`, instead of one `{choice, confidence}` object, so older results files and review mode keep one shape.
> - **CSV export** has a new `confidence` column, placed before the set columns.
> - **Open answers on the presenter screen** scroll inside the card when the list is long; there is no paging.

### B1. Category per set — M

**Story.** As a presenter I want to give a set a category, so that the editor offers the question types and extra functions that fit the kind of session.

**Specification**

- `sets/{id}/category`: `generic` | `consent` | `dilemma`. Default `generic`.
- One table in the code drives everything category-related:

| Category | Question types offered | Default for "+ Add question" | Extra functions |
|---|---|---|---|
| generic | Likert, multiple choice, open | Likert | none |
| consent | generic types + traffic light | traffic light | C1–C4 |
| dilemma | generic types + dilemma | dilemma | none yet |

- The question editor only shows the "add" buttons and type choices of the set's category. The traffic light follow-up prompts (`tlYellow`, `tlRed`) are only shown for `consent`.
- JSON and CSV import: questions of a type the category does not allow are skipped, with a message that says how many and why.
- Changing the category afterwards is allowed only if no existing question has a type the new category lacks; otherwise the dialog says which questions block the change.
- The category is shown as a label in the overview and in the lobby.
- **Assumption:** a category cannot combine consent and dilemma. If you need both in one session, that is a fourth category later.

**AC**

- In a generic set there is no way to create a traffic light or dilemma question (editor, JSON import, CSV import).
- In a consent set "+ Add question" creates a traffic light question; in a dilemma set a dilemma question.
- The migrated `workshop-4` set is `consent` and behaves as it does today.

**Depends on:** A1, A3. B3 for the dilemma default.

### B2. Open question type — M

**Story.** As a presenter I want to ask a simple open question: one question with a text box.

**Specification**

- New kind `open`: `{id, text, kind: "open"}`. Optional `maxLen` (default 500 characters).
- Participant: a textarea and a Submit button. An empty answer cannot be submitted. The answer can be changed until the question is revealed (same rule as other types).
- Storage: the text goes in `texts[qid]` of the vote doc, and `answers[qid] = 1` marks "answered", so progress counters and the "people answered" dots work without changes.
- Presenter, before reveal: number of answers only. After reveal (or with "show live" on): the list of answers, oldest first, with the font size control applied; long lists scroll or paginate like the traffic light comments.
- No mean, median or chart. In the summary an open question shows "{n} answers".
- Exports: JSON gets `kind: "open"` and the answers as a list; CSV gets one row per answer with the text in the existing text column.
- Editor: type choice "Open question"; JSON `{"text": "…", "kind": "open"}`; CSV type `open`.
- "Open saved results" (review mode) reads open questions back.

**AC**

- An open question can be mixed with other types in live mode and in batch mode.
- An answer with line breaks, quotes and emoji survives the round trip to the presenter screen, JSON and CSV.
- Answers are HTML-escaped on the presenter screen.

**Depends on:** B1 (to be offered in the editor).

### B3. Dilemma question type — L

**Story.** As a presenter of a dilemma session I want to ask for a choice plus how confident the participant is in that choice, in one question.

**Specification**

- New kind `dilemma`: `{id, text, kind: "dilemma", options[2..11], conf: {text, min, max, lo, hi}}`.
  - Defaults for `conf`: text "How confident are you in your choice?", scale 1–5, labels "Not at all" and "Very".
- Participant: both parts on one screen, the options first and the confidence scale below. Submit stays disabled until both are filled in. Both parts are saved in one write.
- Storage: `answers[qid]` = option position (as for multiple choice), `conf[qid]` = confidence value. A vote only counts as an answer when both are present and valid.
- Presenter after reveal:
  - per option: count, share and mean confidence of the people who chose it;
  - overall mean confidence;
  - a chart with one bar per option, with the confidence distribution stacked inside the bar using the accent ramp (light = low confidence, dark = high).
- Summary row: most chosen option with its count, plus the mean confidence.
- Exports: JSON holds per respondent `{choice, confidence}` and per option the count and mean confidence; CSV gets an extra column `confidence`.
- Editor: options (one per line) and the confidence scale fields; JSON as in the shape above; CSV type `dilemma`.
- Only offered in sets of category `dilemma`, where it is the default for "+ Add question".

**AC**

- A participant cannot submit with only one of the two parts filled in.
- With 3 votes on A (confidence 5, 4, 3) and 1 on B (confidence 2), the presenter sees A: 3, mean 4.0; B: 1, mean 2.0; overall 3.5.
- Works in live and batch mode, in review mode, and in both exports.

**Depends on:** B1.

---

## Epic C: consent workflow

> **Status: built on 20 Nov 2026**, tried in demo mode (`?demo=1`); not yet run against the live Firebase database.
>
> Differences from the specification below:
> - **Re-vote in "answer all first" mode:** while a proposal is voted on again, both modes show that one proposal on every device, as in one-at-a-time mode. After Reveal the presenter is back on the result screen of that proposal.
> - **Leaving a proposal** means Next question or Finish. Previous does not fix a light.
> - **The Finish button** is the old "Show summary" button, renamed in consent sets. In a set with only traffic light questions in "answer all first" mode, "Start revealing results" goes straight to the closing overview and fixes all lights at that moment.
> - **Clear answers and Reset** also set an edited proposal back to version 1 (with its last text), since its earlier versions are removed.
> - **A duplicate** of a set starts without earlier versions.
> - **Markdown export:** "Objections" and "Concerns" sections are left out when empty; a line "N without votes" is added to the result when a proposal got no votes; "All proposals" lists the proposals only, with their own numbers.
> - **The participant summary screen** is unchanged; the closing overview is for the presenter.

Applies only to sets of category `consent`, and within those to traffic light questions. Values as today: 1 = green (Consent), 2 = yellow (Zorg), 3 = red (Bezwaar).

### C1. Edit a question after red votes and vote again — L

**Story.** As a presenter I want to rewrite a proposal on the spot when there are objections, and let everybody vote again on the new text.

**Specification**

- On the presenter screen of a revealed traffic light question with one or more red votes, a button **Edit** appears next to the navigation buttons. No red votes, no button.
- **Edit** opens a dialog with the question text (large textarea, current text prefilled) and the red and yellow comments below it for reference. Buttons: Save and re-vote, Cancel.
- On save:
  1. The current text, the vote counts and all yellow and red comments are appended to `config.questions[i].history[]` as `{rev, text, counts: {g, y, r}, comments: [{v, text, name?}], t}`.
  2. The question gets the new text and `rev` + 1 (first version = rev 1).
  3. `session.revote = {qid, rev}` is set and the question goes back to "collecting answers" (removed from `revealed`).
- Participants: an answer only counts when it was given for the current `rev`. The vote doc gets `revs[qid]`; votes with an older `rev` are ignored by counts and comments. Each device shows the new text with a notice "The proposal was changed. Please vote again." and empty choice and follow-up fields. This also reaches devices in batch mode that had already finished all questions: they are taken back to this one question.
- The presenter sees the progress of the new vote and reveals as usual. If there are red votes again, **Edit** appears again; there is no limit on the number of rounds.
- Cancel changes nothing.
- The revision number is shown on the presenter screen when it is higher than 1 ("version 2").
- **Assumption:** saving without changing the text is allowed and also starts a new vote (sometimes the discussion alone resolves the objection).
- **Assumption:** in batch mode, **Edit** is available while paging through the revealed questions, and re-voting happens for that single question.

**AC**

- With 1 red vote: Edit visible. After Save, all participant devices show the new text within a few seconds and can vote again; the presenter counter starts at 0.
- Old votes and comments do not appear in the new count, and are kept in `history`.
- A participant who joins after the edit sees only the new text.
- Two edits in a row give `rev` 3 and two history entries.

**Depends on:** B1.

### C2. Final status per question — S

**Story.** As a presenter I want each proposal to end with one clear traffic light.

**Specification**

- The status of a traffic light question is fixed at the moment the presenter leaves it with **Next question** (or **Finish** on the last one), and stored as `session.outcome[qid] = {status, rev, counts: {g, y, r}, t}`.
- Rule: `red` if one or more red votes; otherwise `yellow` if one or more yellow votes; otherwise `green` if at least one vote and all are green; `none` if nobody voted.
- Going back to a question and leaving it again recalculates the status. An edit (C1) clears the stored status of that question.
- Clear answers and Reset session clear `session.outcome` and all `history`. **Assumption:** the edited text itself stays after a clear; only the answers and history go.
- In batch mode the status is fixed in the same way while paging through the reveal; questions the presenter never paged past get their status when the session is finished.
- Other question types in a consent set have no status.

**AC**

- 5 green, 1 yellow, 0 red → yellow. 5 green, 0 yellow, 1 red → red. 6 green → green. 0 votes → none.
- A vote that arrives after **Next question** does not change the stored status.

**Depends on:** B1; C1 for the interplay with revisions.

### C3. Closing overview for consent sets — M

**Story.** As a presenter I want to close the session with an overview of all proposals and their lights, and the details of everything that is not green.

**Specification**

Shown instead of the current summary when the last question has been handled, in sets of category `consent`. Two parts, switchable with tabs or on one scrolling page; **assumption:** tabs "Overview" and "Details", so each fits on a projector.

- **Overview.** All questions in order: number, current text (the updated text where edited, with a small "edited" mark and version number), and the traffic light from C2. Above the list: totals "{g} green · {y} yellow · {r} red". Questions of other types are listed without a light, with their usual short result. The font size control applies; long lists paginate like the existing traffic light table.
- **Details.** Only questions with status yellow or red, red first, then in question order. Per question: number, text, light, vote counts, and below it all red comments and then all yellow comments of the final version, each with the respondent name when named respondents is on (D1). If a question was edited, a collapsed "Earlier versions" section shows each earlier text with its comments.
- A button **Export as Markdown** (C4) on both parts. The existing JSON and CSV buttons stay.
- Clicking a question in the overview opens its result screen, as the summary does now.

**AC**

- A session with 8 proposals (5 green, 2 yellow, 1 red) shows 8 rows with the right lights, and exactly 3 questions in Details.
- An edited question shows its final text in both parts.
- A session with everything green shows Details with the text "No concerns or objections left."

**Depends on:** C2; C1 for versions; D1 for names.

### C4. Markdown export of the consent overview — S

**Story.** As a presenter I want the outcome as a structured Markdown file, so that I can process it further (minutes, decision log, input for an AI assistant).

**Specification**

- Button **Export as Markdown** on the closing overview and in the lobby once outcomes exist. File name `tallyroom-{name}-{stamp}.md`.
- Also available in review mode ("Open saved results"), which requires the JSON export to include `outcome`, `rev` and `history`.
- Structure:

```markdown
# {header}

- Date: 2026-11-20 14:32
- Question set: {name}
- Respondents: 9
- Result: 5 green · 2 yellow · 1 red

## Overview

| # | Proposal | Status | Green | Yellow | Red | Edited |
|---|----------|--------|-------|--------|-----|--------|
| 1 | First 80 characters of the text… | green | 9 | 0 | 0 | no |
| 2 | … | red | 6 | 2 | 1 | yes (v2) |

## Details

### 2. Red

**Proposal (version 2)**

> Full text of the proposal as voted on last.

**Objections (1)**

- (k12) Text of the objection

**Concerns (2)**

- (b59) Text of the concern
- (p03) Text of the concern

**Earlier versions**

Version 1:

> Original text.

- Objection (k12): …
- Concern (b59): …

## All proposals

1. Full text of proposal 1
2. Full text of proposal 2
```

- Status is written as the word (`green`, `yellow`, `red`, `none`), not as an emoji, so the file is easy to parse. All fixed headings and column names are English, including "Objections" and "Concerns", so that the structure is the same for every set; only the proposals and comments are in the language of the session.
- Names in brackets only when named respondents is `yes` or `random`; otherwise the bullet starts with the text.
- Pipes and line breaks in texts are escaped inside the table; full texts in block quotes keep their line breaks.

**AC**

- The file renders correctly in a Markdown viewer and holds every yellow and red comment of the final versions.
- Counts in the table match the closing overview.

**Depends on:** C2, C3.

---

## Epic D: named respondents

> **Status: built on 20 Nov 2026**, tried in demo mode (`?demo=1`); not yet run against the live Firebase database.
>
> Differences from the specification below:
> - **Random names are one letter plus one digit** (`k1`, `b5`, `p0`), changed on request on 20 Nov 2026 from the two digits specified below. That gives 260 names, still more than the 100 connections of the free Firebase plan.
> - **Who gives way on a clash** is decided by the moment the name was claimed (`nameAt` in the vote doc), not by the last activity, so the outcome does not flip while people keep voting.
> - **Changing the setting from the overview or Settings** asks for confirmation when people have already answered. Switching to No removes the names from the stored answers at once.
> - **Someone who answered before names were switched on** shows as "unnamed" until their device has a name.
> - **The presenter's own "View as participant"** follows the same rules: it asks for a name or gets a random one.

### D1. Setting "named respondents" per set — M

**Story.** As a presenter I want to choose per set whether participants are named, get a random name, or stay anonymous.

**Specification**

- `sets/{id}/named`: `yes` | `random` | `no`. Default `no`. Set on creation (A3) and in settings (A8a).
- **`yes`**: before the "You're in" screen the participant gets a field "Your name" (required, 2–30 characters, trimmed). Stored as `name` in the vote doc and in `localStorage` per set (`tr_name_{setId}`), so a reload does not ask again. The participant can change the name through a small "Change name" link in the top bar. If the name is already in use by another device in this set, the participant sees "This name is already in use" and must choose another; the comparison ignores case.
- **`random`**: on first join the device gets a name: one lowercase letter `a`–`z` plus a number `00`–`99` (for example `b59`, `k12`, `p03`). The name is unique within the set: it is drawn again while it collides with a name in the current votes, and written immediately. If two devices still draw the same name at the same moment, the one with the later timestamp draws again when it sees the collision. The participant sees "You are **k12**" on the waiting screen and in the top bar, and cannot change it. Stored in `localStorage` per set, so it survives a reload. 2,600 names are possible; the free Firebase plan caps a session at 100 connections anyway.
- **`no`**: as today. No name field, no `name` in the vote doc.
- A heartbeat from a device without a name in a `yes` or `random` set does not count as "joined".
- Changing the setting while there are answers: allowed, with a warning. From `no` to `yes`: participants are asked for their name at their next screen change. To `no`: names are no longer shown or exported, and are removed from the vote docs.
- Reset session keeps the name on the device (a participant who joins again keeps the same name). **Assumption.**
- The participant join screen says what will happen with the name: "Your name is shown to the presenter with your answers."

**AC**

- `yes`: no participant can answer without a name; two devices cannot hold the same name.
- `random`: 30 devices joining get 30 different names of the form letter + two digits.
- `no`: the vote docs in the database contain no name.
- A reload on a phone keeps the name in both named modes.

**Depends on:** A1; A3 and A8a for the setting itself.

### D2. Show and export names — M

**Story.** As a presenter I want to see who said what, where that helps the conversation.

**Specification**

Applies when `named` is `yes` or `random`.

- Traffic light comments and open answers on the presenter screen carry the name in front: "**k12** · text".
- The lobby shows the names of the people who joined (chips), next to the count.
- While collecting answers, the presenter can see who has not answered yet (a collapsed list "Waiting for: …"). **Assumption:** useful in consent sessions where everybody must vote; it sits behind a click so it is not on the projector by default.
- Charts and counts stay aggregated; no names on bars.
- Exports: JSON and CSV use the name instead of `R01`, `R02`; the Markdown export (C4) puts the name in front of each comment.
- Review mode shows names from an imported file.
- With `named: "no"` nothing changes compared to today.

**AC**

- In a `random` set, each red comment on the presenter screen starts with a name of the form letter + two digits, and the same name appears in CSV, JSON and Markdown.
- In a `no` set, no name appears anywhere and the exports still use `R01`, `R02`.

**Depends on:** D1; B2 and C3/C4 for the places where names appear.

---

## Epic F: follow-up actions for concerns and objections

Added 20 Nov 2026. Not built yet. Applies to sets of category `consent`.

### F1. Action list on the presenter screen — M

**Story.** As a presenter I want to go through all yellow and red remarks at the end of the session and record per remark what we do about it, who owns it and by when, so that the session ends with agreed follow-up instead of a list of comments.

**Specification**

- A third tab **Actions** in the closing overview (C3), next to Overview and Details. It is available as soon as the closing overview is, so after **Finish**. The tab label shows the progress: "Actions (4 / 9)".
- The list holds one row per yellow or red remark on the **final version** of each proposal. Remarks on earlier versions are not listed. **Assumption:** an objection that led to a rewrite is considered handled by the rewrite.
- Rows are grouped per proposal, in question order, with the proposal number, its text and its light as group heading. Within a proposal: red remarks first, then yellow, each oldest first.
- Each row shows: a red or yellow dot, the respondent name when named respondents is on (D1), the remark text, and three fields:
  - **Follow-up action**: free text, up to 300 characters, grows with its content.
  - **Owner**: free text, up to 60 characters. In a named set the field suggests the names of the people in the room; any other text is allowed.
  - **Deadline**: a date field (browser date picker), stored as `YYYY-MM-DD`. Optional.
- Fields save automatically (on leaving the field, and two seconds after the last keystroke), with a small "Saved" mark. There is no Save button.
- A row counts as done when it has an action text. A checkbox **No action needed** per row also makes it done; it greys out the three fields and keeps what was typed.
- Above the list: "{done} of {total} remarks handled", and a filter **Show: all / open only**.
- Only the presenter sees and edits this tab. Participants never see it.
- The font size control applies to the remark texts; the list scrolls, it does not paginate, because rows are being typed in.
- A session without yellow or red remarks shows "No concerns or objections to follow up."
- Read-only cases: an expired set and review mode ("Open saved results") show the list without editable fields.

**Storage**

- `polls/{setId}/actions/{key}` = `{action, owner, due, none, t}`. The existing database rules already cover this path.
- `key` = question id + `_` + device id of the respondent + `_v` + version of the proposal. It stays the same when the list is rebuilt, and an action never attaches to a remark on another version.
- An action whose remark no longer exists (the respondent changed their vote after Finish, or the proposal was edited again) is not shown and not exported, but it is kept in the database until the answers are cleared.
- **Clear all answers** and **Reset session** remove all actions, after the existing confirmation. The confirmation text mentions it when actions exist: "… and 6 recorded actions are removed."
- **Duplicate** does not copy actions. **Delete** removes them with the rest of the set.

**AC**

- A session with 2 red and 3 yellow remarks on final versions shows exactly 5 rows, red before yellow within each proposal.
- Typing an action, an owner and a deadline and reloading the presenter page shows the same values.
- The counter goes from "0 of 5" to "5 of 5" when each row has an action text or is marked "No action needed".
- A second presenter device that has the Actions tab open sees a change within a few seconds, without losing what is being typed there in another row.
- A participant device never receives the Actions tab.

**Depends on:** C2, C3; D1 for names and owner suggestions.

### F2. Markdown export of the action list — S

**Story.** As a presenter I want the action list as a Markdown file, so that I can paste it into minutes or a task tracker, or hand it to an AI assistant.

**Specification**

- Button **Export actions as Markdown** on the Actions tab. It works at any moment, also when not every remark is handled. File name `tallyroom-{name}-actions-{stamp}.md`.
- Fixed English headings and column names; proposals, remarks, actions and owners as typed (see Language).
- Structure:

```markdown
# {header}: follow-up actions

- Date: 2026-11-20 14:32
- Question set: {name}
- Remarks: 5 (2 objections, 3 concerns)
- Handled: 4 with an action, 1 no action needed, 0 open

## Actions by proposal

### 2. Red

> Full text of the proposal as voted on last.

| Type | Remark | By | Action | Owner | Deadline |
|------|--------|----|--------|-------|----------|
| Objection | Text of the objection | k1 | Recalculate the business case | Anna | 2026-12-01 |
| Concern | Text of the concern | b5 | No action needed | | |

### 5. Yellow

> Full text of proposal 5.

| Type | Remark | By | Action | Owner | Deadline |
|------|--------|----|--------|-------|----------|
| Concern | Text of the concern | p0 | (open) | | |

## Actions by deadline

| Deadline | Owner | Action | Proposal |
|----------|-------|--------|----------|
| 2026-12-01 | Anna | Recalculate the business case | 2 |
```

- The column **By** is left out when named respondents is `no`.
- A remark without action and without "No action needed" gets `(open)` in the Action column.
- "Actions by deadline" lists only rows with an action text, sorted by deadline (rows without deadline last), then by owner.
- Pipes and line breaks inside table cells are escaped, as in C4.
- The existing **Export as Markdown** (C4) gets an extra section "## Actions" with the "Actions by deadline" table when at least one action exists, so one file can hold the whole outcome.
- The JSON results export carries the actions per remark, so "Open saved results" can show the list and export it again. The CSV export gets three extra columns `action`, `owner`, `deadline` on the rows of yellow and red answers.

**AC**

- The file renders correctly in a Markdown viewer; every listed remark appears exactly once under "Actions by proposal".
- The counts in the header match the counter on the Actions tab.
- A saved results JSON, opened in review mode, gives the same actions Markdown as the live session did.

**Depends on:** F1; C4 for the shared Markdown rules.

**Open points for this epic**

1. **One action per remark.** Several people often raise the same concern. An option to give one action to several remarks ("same as above") would save typing, at the cost of a more complex list. Left out for now.
2. **Only final versions.** If you also want to record actions for objections that were resolved by a rewrite, the list needs the earlier versions too.
3. **Owner is free text.** It is not checked against the participants, so an owner can be someone outside the room.
4. **Other categories.** Generic and dilemma sets have no yellow or red remarks. Open answers could get the same three fields later.

---

## Epic E (later): multiple languages for question texts

Not planned now. Specified far enough to check that A to D do not block it.

### E1. Question texts in several languages, chosen by the participant — L

**Story.** As a participant I want to pick my language and read the questions in that language. As a presenter I want to enter each question in the languages of my audience.

**Specification**

- `sets/{id}/languages`: ordered list of language codes, for example `["nl", "en"]`. The first is the default language. A set with one language, or without this field, behaves exactly as today.
- Every content text may be either a string (one language, as today) or a map per language: `"text": {"nl": "…", "en": "…"}`. This holds for the header, question text, option labels, scale labels, traffic light labels, follow-up prompts and the dilemma confidence question. The helper `tx(value, lang)` returns the text for the language, and falls back to the default language when a translation is missing.
- Editor: with more than one language, a language switch at the top of the question editor; each text field shows the chosen language, with a mark on questions that miss a translation. JSON import and export accept both shapes.
- Participant: with more than one language, a language choice on the join screen and a switch in the top bar. The choice is kept in `localStorage` per set. The interface around the question stays English.
- Presenter screen: shows the default language, with a switch for the presenter.
- Answers are independent of language: votes are stored as option positions, so results from all languages add up in one count. Open answers and comments are shown as typed, not translated.
- Consent edit (C1): the edit dialog shows a field per language. Saving starts a new vote for everybody. A language whose text was not updated is marked "not updated" for the presenter, and participants in that language get the default-language text for this version.
- Exports: questions export holds all languages; results exports (JSON, CSV, Markdown) use the default language, with a language choice on the export button.
- The language a participant chose is stored in the vote doc (`lang`) and included in the exports.

**AC**

- Two phones on the same set, one on `nl` and one on `en`, see the same question in their own language, and both votes land in the same count.
- A set that was created before E1 works without any change.
- A question without an `en` text is shown in the default language to a participant who chose `en`.

**Depends on:** A1, A8a (set settings), B1; touches B2, B3, C1, C3, C4.

---

## Open decisions

Choices I made to keep the items implementable. Change them here before you start the item.

1. **Header versus name (A1, A3).** I gave a set two labels: a `name` for your overview ("MT offsite team B") and a `header` that the audience sees. If one label is enough, drop `name`. AGREE
2. **Presenter rights (A1).** One shared `HOST_KEY` gives access to all sets. "In parallel in different team settings" could also mean different presenters who should not see each other's sets; that needs a key per set or real sign-in, and is a separate item. AGREE
3. **Expiry is not enforced by the database (A7).** Good enough for workshops; real enforcement needs rules that compare `now` with `expiresAt`. AGREE
4. **Decided: all purple follows the accent (A5).** Buttons, logo mark and bars, and also the faint page tint, borders and text tints. The alternative, a neutral grey page for every accent, is simpler but changes how today's purple sets look.
5. **No mixing of consent and dilemma in one set (B1).**  AGREE
6. **Saving an edit without text change starts a new vote (C1).** NO: after an edit without changes, just show the current question again and only proceed to the next question if the presenter clicks on Next Question
7. **Edit in batch mode (C1, C2).** Your description follows the one-at-a-time flow ("Next question"). I made it work in batch mode too; the alternative is to force consent sets into one-at-a-time mode, which is simpler. THE EDIT MODE ONLY NEEDS TO BE AVAILABLE IN ONE-AT-A-TIME MODE, SO DON'T BOTHER ADDING IT TO BATCH MODE
8. **Clear answers keeps edited texts (C2).** AGREE
9. **Named `yes`: duplicate names are refused (D1).** The alternative is to allow them and add a suffix ("Jan (2)"). AGREE
10. **Presenter can see who has not answered yet (D2).** Leave out if that feels like too much pressure on participants. MAKE IT AN OPTION FOR THE PRESENTER
11. **English defaults for new traffic light questions (Language).** New questions get "Consent / Concern / Objection" and English follow-up prompts instead of today's Dutch ones. If most of your consent sessions are Dutch, a per-set default (or keeping the Dutch defaults) saves retyping. AGREE

## Not in this backlog, but worth knowing

All three were done together with Epic A (20 Nov 2026):

- `index.html` and the files it loads are the only source; the README no longer refers to `tallyroom.html`.
- The single file is split into `config.js`, `css/styles.css`, `js/core.js` (pure logic), `js/backend.js` (data) and `js/app.js` (screens), still without a build step.
- `tests/core.test.js` (run with `node --test`) covers `js/core.js`. The rules for C1, C2 and D1 were written with their tests before those items were built: the status rule of C2 (`trafficStatus`), the revision filter of C1 (`answerIsCurrent`, `trafficCounts`) and the unique random names of D1 (`randomName`).
