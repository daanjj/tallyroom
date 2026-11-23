# Tally Room backlog

Written 20 Nov 2026 against `index.html` at commit `60459c6`.

## How to read this

- Items are grouped in epics A to H (E is parked for later; G is security and stands apart from the features; H brings users, ownership and sharing). IDs are stable (`A1`, `B3`, …) so they can be referenced in commits.
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
| 9 | G1, G2, G3, G4 | Security: sign-in and database rules, as one release, between sessions |
| 10 | G7 | Small and independent; can also go first |
| 11 | G6, then G5 | App Check when the rules have run for a session; G5 only when named or sensitive sets ask for it |
| 12 | H1 | Pure logic for owners, sharing and rights; changes nothing on screen |
| 13 | H2, H3, H4, H5 | Users, migration, rules and the page, as one release, between sessions |
| 14 | H6, H7 | Sharing, then the admin screens |
| 15 | H8, H9 | Onboarding from the page; until then users are added by hand |

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
- `setId`: the name of the set as a slug (`MT offsite, team B` gives `mt-offsite-team-b`, with `-2`, `-3`… when taken), generated on creation. It does not follow a later rename; **More → Change link** moves the set to another id, after which the old link and QR code stop working. (Originally: 8 random characters that never change.)
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

- Shown to the presenter when there is no `?set=` in the URL, and reachable from the lobby through a link "Manage question sets" in the top bar.
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

- New kind `dilemma`: `{id, text, kind: "dilemma", options[2], conf: {text, min, max, lo, hi}}`. Exactly two options: the editor and "Create from file" refuse a dilemma with more or fewer.
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

### C1. Edit a question after yellow or red votes and vote again — L

**Story.** As a presenter I want to rewrite a proposal on the spot when there are concerns or objections, and let everybody vote again on the new text.

**Specification**

- On the presenter screen of a revealed traffic light question with one or more yellow or red votes, a button **Edit** appears next to the navigation buttons. Only green votes (or none), no button.
- **Edit** opens a dialog with the question text (large textarea, current text prefilled) and the red and yellow comments below it for reference. Buttons: Save and re-vote, Cancel.
- On save:
  1. The current text, the vote counts and all yellow and red comments are appended to `config.questions[i].history[]` as `{rev, text, counts: {g, y, r}, comments: [{v, text, name?}], t}`.
  2. The question gets the new text and `rev` + 1 (first version = rev 1).
  3. `session.revote = {qid, rev}` is set and the question goes back to "collecting answers" (removed from `revealed`).
- Participants: an answer only counts when it was given for the current `rev`. The vote doc gets `revs[qid]`; votes with an older `rev` are ignored by counts and comments. Each device shows the new text with a notice "The proposal was changed. Please vote again." and empty choice and follow-up fields. This also reaches devices in batch mode that had already finished all questions: they are taken back to this one question.
- The presenter sees the progress of the new vote and reveals as usual. If there are yellow or red votes again, **Edit** appears again; there is no limit on the number of rounds.
- Cancel changes nothing.
- The revision number is shown on the presenter screen when it is higher than 1 ("version 2").
- **Assumption:** saving without changing the text is allowed and also starts a new vote (sometimes the discussion alone resolves the objection).
- **Assumption:** in batch mode, **Edit** is available while paging through the revealed questions, and re-voting happens for that single question.

**AC**

- With 1 red vote or 1 yellow vote: Edit visible. With only green votes: no Edit. After Save, all participant devices show the new text within a few seconds and can vote again; the presenter counter starts at 0.
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

Added 20 Nov 2026. Applies to sets of category `consent`.

> **Status: built on 20 Nov 2026**, tried in demo mode (`?demo=1`) on one presenter device; not yet run against the live Firebase database.
>
> Differences from the specification below:
> - **A change from a second presenter device** shows on the first one at its next redraw; a field that is being typed in keeps what was typed there.
> - **"Open only" filter:** a row you are typing in stays visible until you leave it, even when it is no longer open.
> - **Group heading:** a proposal shows Red when it has an objection among its remarks and Yellow otherwise, also when its fixed light differs because a remark came in later.
> - **Actions whose remark is gone** stay in the database until the answers are cleared, as specified, but they are also not counted in the "recorded actions are removed" confirmation unless they have a text or "No action needed".
> - **"Publish to the room" in review mode** does not write the actions of a saved file to the live set.

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

## Epic G: security

Added 20 Nov 2026, after a review of the setup as it stands. Applies to the Firebase backend; demo mode (`?demo=1`) keeps working without sign-in and without rules.

> **Status: G1 to G4 built on 20 Nov 2026**, tried in demo mode and with tests against a stand-in for Firebase (`tests/backend.test.js`). **Not yet live:** the providers and the `presenters` list are not set up in the Firebase console, the rules are not published, and none of the AC that need the real database (Rules Playground, three phones) have been run. G5, G6 and G7 are not built.
>
> Differences from the specification below:
> - **New sets get four random characters behind the name** (`mt-offsite-team-b-x7k2`), per open decision 14. Change link suggests such a link too, and still accepts any link typed by hand.
> - **Texts in a vote record may be 2,000 characters**, not 500: the editor allows an open question a `maxLen` up to 2,000 and a follow-up text is 600, and the rules must not refuse what the page writes.
> - **Expiry follows the server's clock on every device** (`.info/serverTimeOffset`), so the expired screen appears at the moment the rules start refusing. A time stamp ahead of the server is held back to the server's time, so a phone with a fast clock is not locked out.
> - **Signing out on a set page** swaps the presenter account for an anonymous one in one step; live listeners are attached again on every change of identity.
> - **The page signs in anonymously on a set page only.** The overview and the sign-in screen need no identity.
> - **A signed-in account that is not a presenter** is an ordinary participant on a set page.
> - **The HTTPS fallback for participants** reads `config`, `session` and `votes` separately.
> - The demo backend keeps its device id under `tr_demo_pid`, because `tr_pid` is removed.

**Where it stands today** (before G1 to G4)

- The database rules allow everyone to read and write `sets` and `polls/{id}`, without sign-in. Whoever has the database URL can read every set, every answer and every name, change or delete them, or fill the database, without using the page.
- The database URL and `HOST_KEY` are in `config.js`, which every visitor's browser downloads. Any participant can read the key and open the page with `?host=…`. The key only switches the presenter buttons on; the database does not check it.
- Expiry (A7) is checked by the page only. A direct write to an expired set still works.
- A vote record is keyed by a device id that the device makes up itself (`tr_pid`). Nothing stops one device from writing another device's record.
- Every device reads all answers of its set, including names and comments in a named set (D1).
- Since set ids follow the name, links can be guessed. That changes little while the whole list of sets is readable anyway; it starts to matter once G4 closes the list.

**What this epic changes**

| Item | Closes |
|---|---|
| G1 | Anyone can become presenter |
| G2 | One device can write another device's answers |
| G3 | Anyone can change or delete sets, questions and sessions; answers after expiry |
| G4 | Anyone can list all sets and read the follow-up actions |
| G5 | Participants can read each other's answers, names and comments |
| G6 | The database can be used from outside the page |
| G7 | Tampered third-party scripts; a missed escape |

**G1, G2, G3 and G4 go live as one release**: the rules of G3 and G4 need the sign-ins of G1 and G2, and the sign-ins protect nothing without the rules. G5, G6 and G7 are separate and optional.

**What stays as it is**

- Participants do not make an account and do not type anything to join. Scanning the QR code is enough.
- No server and no build step. Everything is Firebase Authentication, database rules and the static page.
- All presenters see and manage all sets (open decision 2). Sets per presenter are not part of this epic.
- Not solved: a participant who clears the browser storage counts as a new participant and can answer again; a participant can fill their own record with many answers; Firebase rules cannot limit how often a device writes. G6 reduces the last one, nothing here removes it.

### G1. Presenter sign-in — L

**Story.** As a presenter I want to sign in with an account, so that participants cannot make themselves presenter by reading a key from the page.

**Specification**

- Firebase Authentication, provider **email and password**. Accounts are made by hand in the Firebase console (Authentication → Users → Add user). The page has no sign-up. **Assumption:** a handful of presenters; see open decision 12 for Google or Microsoft sign-in instead.
- Who is presenter is a list in the database: `presenters/{uid}: true`. It is filled by hand in the Firebase console (Data tab). Nobody can write it through the page or the rules; a signed-in user can read only their own entry.
- A device is presenter when it is signed in with an account whose uid is in that list. This replaces `HOST_KEY`, `?host=KEY` and the `tr_host` flag in `localStorage`.
- Sign-in screen at `?host` (any value, so old bookmarks with `?host=KEY` land there): fields **Email** and **Password**, button **Sign in**, link **Forgot password** (sends the Firebase reset mail and always answers "If this address has an account, a mail is on its way"). After sign-in the page returns to where it was, without `host` in the address: the overview, or the set when the link held `?set=…`.
- Wrong email or password: one message, "Email or password is not right", without saying which. Signed in but not in `presenters`: "This account is not a presenter. Ask the owner of this Tally Room to add it", with **Sign out**.
- The sign-in is remembered on the device (Firebase's default, local persistence). **Sign out** sits in the top bar of the overview and of the presenter view of a set. `?host=off` signs out too, as today.
- The page without `?set` and without sign-in shows the participant notice as today ("Scan the QR code or open the link you received"), plus a small link **Presenter sign-in** to `?host`.
- Boot order: the page waits for the first authentication state before it decides between presenter and participant, behind the existing "Connecting…" screen. A presenter who signs out on a set page becomes a participant of that set at once, without reload.
- Code: `index.html` loads `firebase-auth-compat.js` in the same version as the other Firebase scripts. `resolveHost` in `js/backend.js` goes; the backend gets `signIn(email, password)`, `signOut()`, `resetPassword(email)` and `onAuth(f)`, and `isHost` becomes a value that can change while the page is open. The demo backend keeps today's behaviour: presenter unless `?host=off`, nothing to sign in to.
- The one-off migration of `MIGRATE_POLL_ID` keeps running for a signed-in presenter only.
- Clean-up on the first load of the new version: remove `tr_host` and any `tr_host_*` from `localStorage`. `HOST_KEY` is removed from `config.js`, from the example in `tallyroom-setup.md` and from the README.
- `tallyroom-setup.md` gets the steps: switch on Email/Password in Authentication, add a user, copy its uid to `presenters/{uid}: true`, and add the site's domain under Authentication → Settings → Authorised domains.

**AC**

- A browser that never signed in, opened with `?host=anything`, gets the sign-in screen and no presenter buttons.
- `config.js` as served to visitors holds no secret: reading it gives no way to become presenter.
- After signing in on a laptop, closing the browser and opening the overview again shows the sets without signing in again.
- An account that is not in `presenters` gets the "not a presenter" message and sees no sets.
- **Sign out** on a set page turns the screen into the participant screen of that set within a second.
- Demo mode works as before, without a sign-in screen.

**Depends on:** A1, A2. Goes live together with G2, G3 and G4.

### G2. A participant identity the database can check — M

**Story.** As a participant I want my answers to be mine alone, so that nobody else in the room can change or remove them.

**Specification**

- Every device that is not signed in as presenter signs in **anonymously** with Firebase Authentication, automatically and without any screen. The uid of that sign-in is the device id, and so the key of its vote record: `polls/{setId}/votes/{uid}`.
- This replaces the self-made id in `tr_pid`. On the first load of the new version `tr_pid` is removed.
- A presenter uses the uid of the presenter account. Answering in participant view on the presenter laptop writes to `votes/{that uid}`, as it does today under the laptop's device id.
- The anonymous sign-in is kept on the device by Firebase, so a phone that reloads or comes back from sleep is the same participant, as today. Clearing the browser storage or using a private window gives a new participant, also as today.
- Order at boot: sign in anonymously first, then attach the listeners of the set. When anonymous sign-in fails (blocked storage, network), the participant sees "Could not connect. Check your connection and reload", not an empty voting screen.
- Keys that contain the device id keep their shape with the new id: `actions/{questionId}_{uid}_v{version}` (F1) and `tr_name_{setId}` in `localStorage` (D1).
- The exports keep showing the device id as they do today; it is now the uid.
- **Existing answers:** records under the old ids stay readable and countable, but no device owns them any more. A participant who returns to a running set after the switch gets a new record, so would count twice. **Assumption:** the switch is made between sessions, and running sets are reset or exported first. No migration of old records.
- Setup: switch on the **Anonymous** provider in Authentication. **Assumption:** anonymous accounts are left to pile up; the Firebase console can delete them automatically after 30 days when the project is upgraded to Identity Platform, which is optional.
- Demo backend: unchanged, it keeps its own local id.

**AC**

- A phone that joins a set appears under Authentication → Users as an anonymous user, and its vote record has that uid as key.
- Reloading the phone keeps the same record; the count of respondents does not go up.
- With the rules of G3 in place, a write to `votes/{another uid}` from the browser console of a participant is refused.
- A presenter answering in participant view has one record, under the presenter uid.

**Depends on:** A1, D1, F1. Goes live together with G1, G3 and G4.

### G3. Database rules: who may write what — M

**Story.** As a presenter I want the database itself to refuse what the page would not do, so that someone with technical skill cannot change my sets, end my session or vote after expiry.

**Specification**

- The rules live in the repository as `database.rules.json` and are the source for the block in `tallyroom-setup.md`. Publishing stays a manual step in the Firebase console (Rules tab), or `firebase deploy --only database` for who has the Firebase CLI.
- "Presenter" in a rule means: `auth != null && root.child('presenters').child(auth.uid).val() === true`.
- Writing, per path:

| Path | Who may write |
|---|---|
| `presenters` | Nobody (console only) |
| `sets`, `sets/{id}` | Presenter |
| `polls/{id}` and everything below it (`config`, `session`, `actions`, all `votes`) | Presenter |
| `polls/{id}/votes/{uid}` | Also the device with that uid, when the set exists and is not expired |

- "The set exists" = `sets/{id}` exists. "Not expired" = `sets/{id}/expiresAt` is missing or greater than `now` (the server's clock). This makes expiry (A7) real: the server refuses a participant's answer after the expiry moment, whatever the clock of the phone says.
- The presenter keeps full write access to all votes, because Clear all answers, Reset session, removing names (D1), Change link and Delete write or remove the records of others. The presenter can also write in an expired set, as today (Extend, exports, paging).
- Shape of a vote record, checked on every write:
  - `round` and `t` are required numbers; `t` is at most one minute ahead of the server's clock.
  - `answers/{qid}`, `conf/{qid}` and `revs/{qid}` are numbers.
  - `texts/{qid}` is a string of at most 500 characters (the limit of an open answer, `OPEN_MAX`; a follow-up text is shorter).
  - `name` is a string of at most 30 characters; `nameAt` is a number.
  - `typing/{qid}` is a number, at most one minute ahead of the server's clock: the time a participant last typed in the follow-up box (the presenter shows "still writing" from it).
  - Any other field is refused.
- Before building, compare this list with what the page writes (`stampDoc`, `myVotes`, the heartbeat and the vote actions in `js/app.js`) and add what is missing. A record the rules refuse must never be something the page writes.
- The page handles a refused write: a participant whose answer is refused because the set just expired gets the expired screen (A7), not a silent loss; any other refusal shows "Your answer could not be saved. Reload the page".
- Things the rules cannot do, and that stay as they are: limit the number of answers in one record, limit how often a device writes, or check that an answer is within the scale of its question. The page keeps ignoring answers that do not fit the question (`validAns`).
- **Change link** writes the new and the old id in one update; every path in it is a presenter path, so it keeps working. Records from before G2 that hold a field the shape check refuses would block the move: the move then reports "This set holds answers in an old format. Clear the answers or export them first".
- `tallyroom-setup.md`: the rules block is replaced, with a line for people who upgrade: publish the rules in the same half hour as the new files, because the old page cannot write under the new rules and the new page is not protected under the old ones. The troubleshooting list gets "Votes are refused: the rules are published but the Anonymous provider is off".

**AC**

Each of these is tried with the Rules Playground in the Firebase console or from the browser console, and noted in the pull request:

- Not signed in: writing anything, anywhere, is refused.
- Anonymous participant: writing `sets/{id}`, `polls/{id}/config`, `polls/{id}/session`, `polls/{id}/actions/x` and `polls/{id}/votes/{other uid}` is refused; writing `polls/{id}/votes/{own uid}` with a valid record succeeds.
- Anonymous participant, expired set: writing the own record is refused. After **Extend** by the presenter it succeeds again without reload.
- Anonymous participant, set id that does not exist: writing `polls/{that id}/votes/{own uid}` is refused, so the database cannot be filled under made-up ids.
- A record with an extra field, with a text of 501 characters or with a name of 31 characters is refused.
- Presenter: create, edit, duplicate, change link, clear, reset, the consent edit (C1), the action list (F1) and delete all work as before.
- A full session in a consent set and in a dilemma set, with three phones, runs without a refused write in the console.

**Depends on:** G1, G2; touches A7, A8, C1, D1, F1.

### G4. The list of sets and the follow-up actions are not public — S

**Story.** As a presenter I want a participant of one set not to see which other sets exist or what we agreed as follow-up, so that one team's link does not open another team's session.

**Specification**

- Reading, per path:

| Path | Who may read |
|---|---|
| `presenters/{uid}` | The signed-in user with that uid |
| `sets` (the whole list) | Presenter |
| `sets/{id}` (one set, when you know its id) | Any signed-in device, so also an anonymous participant |
| `polls` (the whole list) | Nobody |
| `polls/{id}` as a whole | Presenter |
| `polls/{id}/config`, `/session`, `/votes` | Any signed-in device |
| `polls/{id}/actions` | Presenter |

- A participant therefore reads exactly the set of the link, and needs that link to do so. Reading without any sign-in is refused everywhere.
- The plain HTTPS reads in `js/backend.js` (`rest(…)`, used for `readPoll` and for the lobby fallback `pull`) send the ID token of the signed-in device. The participant fallback no longer reads `polls/{id}` as a whole, which the rules now refuse, but `polls/{id}/session` and `polls/{id}/config`.
- The name of a set (`sets/{id}/name`, "only you see this") stays readable for a participant of that set who looks in the database. **Assumption:** acceptable; a name that must stay private does not belong in the name field.
- Guessable links: with the list closed, the id is what keeps a set apart. A name such as "MT offsite" gives a link that a colleague could guess. The dialog **New question set** and **Change link** get one line: "Anyone who knows or guesses this link can join and see the results shown to the room." No random suffix is added. **Assumption:** readable links are worth more here than unguessable ones; see open decision 14.
- Complete rules after G1 to G4 (`database.rules.json`); `P` stands for the presenter condition of G3 and is written out in the file:

```json
{
  "rules": {
    "presenters": {
      "$uid": { ".read": "auth != null && auth.uid === $uid" }
    },
    "sets": {
      ".read": "P",
      ".write": "P",
      "$set": { ".read": "auth != null" }
    },
    "polls": {
      "$set": {
        ".read": "P",
        ".write": "P",
        "config": { ".read": "auth != null" },
        "session": { ".read": "auth != null" },
        "votes": {
          ".read": "auth != null",
          "$uid": {
            ".write": "auth != null && auth.uid === $uid && root.child('sets').child($set).exists() && (!root.child('sets').child($set).child('expiresAt').exists() || root.child('sets').child($set).child('expiresAt').val() > now)",
            ".validate": "newData.hasChildren(['round', 't'])",
            "round": { ".validate": "newData.isNumber()" },
            "t": { ".validate": "newData.isNumber() && newData.val() <= now + 60000" },
            "name": { ".validate": "newData.isString() && newData.val().length <= 30" },
            "nameAt": { ".validate": "newData.isNumber()" },
            "answers": { "$q": { ".validate": "newData.isNumber()" } },
            "conf": { "$q": { ".validate": "newData.isNumber()" } },
            "revs": { "$q": { ".validate": "newData.isNumber()" } },
            "texts": { "$q": { ".validate": "newData.isString() && newData.val().length <= 500" } },
            "$other": { ".validate": false }
          }
        }
      }
    }
  }
}
```

- This block is a starting point, written without running it; `database.rules.json` is the version to publish (it differs in the text limit, see the status note). Publishing it is part of the item, and so is every check under AC here and in G3. **Both are still to do.**

**AC**

- Anonymous participant of set A: reading `sets` is refused; reading `sets/{A}` succeeds; reading `polls/{A}/actions` is refused; reading `polls` is refused.
- Opening `{databaseURL}/sets.json` and `{databaseURL}/polls/{A}.json` in a browser without sign-in gives "Permission denied".
- A phone in the lobby whose live connection is cut still moves to question 1 within a few seconds after the presenter starts, through the HTTPS fallback.
- The overview of the presenter shows all sets with their counts, as before.

**Depends on:** G1, G2, G3; touches A2, A6, F1.

### G5. Participants cannot read each other's answers — L

> **Status: built on 21 Nov 2026.** Phones read their own record, `shown` and `names`; the presenter's screen publishes `shown` (core `shownVotes`: one record per answer of a revealed question, keyed by question plus a position from a hash, `t` as the rank of answering, so records cannot be linked to a device or across questions). **Deviations from the specification:** (1) names are a list `names/{uid}: {n, at}` that participants of the set can read, not a register by name that nobody can list; uniqueness keeps the existing check (the later claim gives way). A register by name stays open. (2) Phones show results after a reveal only, as before; there is no "show live" on phones and no joined count, so `shown/_room` is not needed. Tried: tests, and demo mode with a presenter tab and a participant tab (results match, nothing before Reveal, no double count). **Not tried:** the rules against the real database.


**Story.** As a participant in a named set I want my answers and comments to reach the presenter only, so that I can be open without everyone in the room being able to pull my answers from the database.

Optional, and the largest item of this epic. Worth building when sets are named (D1) or the topics are sensitive; see open decision 15.

**Specification**

- Reading `polls/{id}/votes` as a whole becomes presenter only. A device reads its own record: `polls/{id}/votes/{uid}`.
- The participant screen uses other people's answers in three places today. Each gets a replacement:
  1. **Results on the phone** (after Reveal, or with "show live"). The presenter device publishes what the room may see to `polls/{id}/shown/{questionId}`: the counts per answer and, where the room sees them today, the comments and open answers with names. It is written when the presenter reveals a question and kept up to date while it is shown; with "show live" it is updated at most once a second. Presenter writes, any signed-in device reads. A phone draws its charts from `shown`, never from votes. Nothing appears on a phone that the presenter screen does not show to the room.
  2. **Unique names** (D1). A register `polls/{id}/names/{name in lowercase}: uid`. A device may write an entry that does not exist yet, with its own uid as value, and may remove its own entry; nobody can read the register as a list. Claiming a name is one write: when it is refused the name is taken, and the participant gets today's message. Changing a name claims the new one first and then releases the old one. Random names (`k1`, `b5`) try a name and take the next one on refusal. This replaces `otherNames` and `mustYieldName` on the participant side; two devices can no longer hold the same name, so giving way is not needed.
  3. **The count "n people joined"** on the participant screen, where shown: taken from `polls/{id}/shown/_room` (`joined`, `answered`), published by the presenter device like the results.
- The presenter device reads all votes as today; nothing changes on the presenter screen.
- Consequence: results on phones only update while a presenter device has the set open. That is the case in every session; a set that is left alone shows its last published state.
- Clear all answers, Reset session and switching named respondents to "No" also clear `names` and `shown`. Duplicate copies neither. Change link and Delete take them along with the rest of the set.
- Rules, on top of G4: `votes/.read` moves to the presenter and `votes/$uid/.read` to the owner; `shown` is presenter write and signed-in read; `names/$name` is writable when `!data.exists() && newData.val() === auth.uid`, or `data.val() === auth.uid && !newData.exists()`, or by the presenter, with the name at most 30 characters.
- The exports are unchanged: they are made on the presenter device from the votes.

**AC**

- Anonymous participant: reading `polls/{id}/votes` and `polls/{id}/votes/{other uid}` is refused; reading the own record succeeds.
- Two phones that type the same name at the same moment: one gets the name, the other gets "That name is taken", every time.
- After Reveal a phone shows the same counts as the presenter screen, within two seconds.
- With "show live" on, a phone follows the presenter screen with at most a second of delay.
- Before Reveal, `polls/{id}/shown/{questionId}` does not exist or is empty, so nothing can be read ahead of the presenter.
- Random names are still unique in a room of 30 phones that join within ten seconds.

**Depends on:** G1 to G4, D1, D2; touches C1, C3, F1.

### G6. App Check — S

> **Status: switched on and enforced for Realtime Database on 21 Nov 2026.** Fraud Defense (reCAPTCHA Enterprise) site key in `config.js`; the App Check metrics showed all requests verified before enforcing. Checked on the live page: the page reads the database, and a plain HTTPS read with a valid ID token but without an App Check token is refused (401). Authentication is not enforced. (Built on 20 Nov 2026, first with the reCAPTCHA v3 provider.)
>
> Differences from the specification below:
> - **The debug token is never in a file.** On `localhost` the Firebase script makes one per browser and prints it in the console; it is registered in the Firebase console by hand. A token in `config.js` would be public.
> - **The policy of G7 lists the reCAPTCHA addresses always**, also without a key, because the policy is a fixed tag in `index.html`.
> - The App Check script is in `vendor/` like the other Firebase scripts.

**Story.** As the owner of the installation I want the database to accept requests from my page only, so that scripts cannot fill or read it from elsewhere with a self-made anonymous sign-in.

**Specification**

- Firebase App Check with the **Fraud Defense (reCAPTCHA Enterprise)** provider (changed from reCAPTCHA v3 on 21 Nov 2026: Firebase no longer accepts classic keys), registered for the site's domain. `index.html` loads `firebase-app-check-compat.js`; `config.js` gets `APPCHECK_SITE_KEY` (a public key, not a secret). Without that key the page runs without App Check, so an installation can do G1 to G4 first.
- The plain HTTPS reads (`rest(…)`) send the App Check token in the `X-Firebase-AppCheck` header.
- Enforcement for the Realtime Database is switched on in the console only after the App Check metrics show that requests from the page are verified, at least one session later.
- Local development and `tests`: a debug token for `localhost`, described in `tallyroom-setup.md`. Demo mode does not touch Firebase and is not affected.
- Fraud Defense, score-based, shows no puzzle; it does load a Google script and sets the reCAPTCHA badge. **Assumption:** acceptable; mention it in the setup guide for who has to account for third parties.
- Known limit: App Check raises the effort, it is not a guarantee. The rules of G3 and G4 remain the real protection.

**AC**

- With enforcement on, a `curl` to `{databaseURL}/sets/{id}.json` with a valid ID token but without App Check token is refused.
- A phone on mobile data joins and votes without seeing a puzzle.
- The page on `localhost` works with the debug token.
- An installation without `APPCHECK_SITE_KEY` works as before.

**Depends on:** G1 to G4.

### G7. Smaller hardening: scripts and escaping — S

> **Status: built on 20 Nov 2026.** The hostile set was run through every phase in demo mode (presenter and participant view, names, comments, open answers, edit dialog, closing overview, actions): the texts show as typed, no dialog, no policy violations. The real page was loaded under the policy up to the sign-in screen and the database connection. **Not tried:** signing in and live voting against Firebase under the policy (step 9 is not live yet), and opening a CSV in a spreadsheet.
>
> Differences from the specification below:
> - **The database connects through WebSockets only.** Firebase otherwise starts with long polling, which loads scripts from the database host; allowing that host for scripts would let any Firebase database serve script to the page. A network that blocks WebSockets can therefore no longer connect.
> - **Google Fonts stays an outside host** for the stylesheet and the font files (not scripts); the policy lists it.
> - **Numbers and ids are made safe where they come in** (`tidyQuestion` in `js/core.js`, for the database and for files), next to `esc()` in the templates. The pass found unescaped question ids, version numbers, counts of earlier versions and the round number; all other texts were escaped already.
> - **Markdown writes `<` as `\<`**, which Markdown shows as a plain `<`.
> - The CSV guard also covers a cell that starts with a tab or a carriage return.

**Story.** As the owner of the installation I want the page to run only the code I put there and to show participant text as text, so that neither a changed third-party file nor a crafted answer can take over the presenter screen.

**Specification**

- **Third-party scripts.** The QR library and the Firebase scripts move into the repository as `vendor/…`, at the versions in use, and `index.html` loads them from there. No script comes from another host any more (with G6: except reCAPTCHA, which cannot be self-hosted). The README lists the files, their versions and where they came from, so they can be updated on purpose.
- **Content Security Policy** as a `<meta>` tag in `index.html`: scripts from the site itself only (plus the reCAPTCHA hosts with G6); connections to the site, the database host (`https` and `wss`) and the Firebase Authentication hosts; images from the site and `data:` (the QR code); inline styles stay allowed, because the page sets colours and sizes inline. No inline scripts and no `eval`.
- **Escaping.** Every text that comes from the database or from a file goes through `esc()` before it becomes HTML: set name and header, question texts, option and scale labels, follow-up prompts, comments, open answers, respondent names, action texts and owners, the join link, and everything from "Open saved results". One pass through `js/app.js` checks each template; what is found is fixed.
- A test set for that pass, kept as `tests/fixtures/hostile-set.json`: every text field holds `<img src=x onerror=alert(1)>` and `"><script>alert(1)</script>`. Importing it and running a session must show the texts literally.
- The Markdown and CSV exports: a cell that starts with `=`, `+`, `-` or `@` gets a leading apostrophe in the CSV, so a spreadsheet does not run an answer as a formula. Markdown exports escape `|` in table cells and never produce raw HTML from an answer.

**AC**

- With the network tab open, loading the page fetches scripts from the site's own host only.
- The hostile set, run through every phase on a presenter screen and a phone, in a consent set with names and actions: no dialog appears, the texts are shown as typed, and the console shows no Content Security Policy violations in normal use.
- A CSV export with the answer `=1+1` opens in a spreadsheet as the text `=1+1`.
- QR codes, sign-in (G1) and live voting work with the policy in place.

**Depends on:** none for scripts and escaping; the policy lists the hosts of G1, G2 and G6 when those are built.

---

## Epic H: users, ownership and sharing

Added 23 Nov 2026. Applies to the Firebase backend; demo mode (`?demo=1`) keeps working without sign-in, as one made-up admin.

> **Status: the whole epic, H1 to H9, is built on 23 Nov 2026**, with tests and tried in demo mode (as admin and with `&role=user`). H1 to H5 are the release that can go live; H6 to H8 can go with it or follow. **Not live:** the rules are not published, nothing has run against the real database or the real Firebase Authentication (no mail has been sent, no account made from the page), and the log in `tests/rules-checklist.md` is still empty. Before H8 is used: the mail template and the password policy in the Firebase console (`tallyroom-setup.md`, steps 1b.5 and 1b.6).

**Where it stands today** (before this epic)

- Every account in `presenters/{uid}` sees and manages every set (open decision 2). A set has no owner.
- Accounts are made by hand in the Firebase console; the page has no way to add a user or to change a password, only **Forgot password**.

**What this epic changes**

- A set has an **owner**, a **visibility** (`private` or `public`, private by default) and a list of users it is **shared** with.
- Users are **admin** or **user**. "Presenter" stops being a right on the whole installation and becomes a right per set.

| Right on a set | Who has it |
|---|---|
| **Manage**: edit questions and settings, run sessions, read and export answers and actions, extend, clear, reset | Owner, users it is shared with, admins |
| **Control**: delete, change link, switch private / public, change who it is shared with | Owner, admins |
| **Assign** to another owner | Admins |
| **View** questions and settings read-only, and duplicate | Every user, when the set is public |
| **Take part** | Everyone with the link, as today |

**What stays as it is**

- Participants do not make an account. Whoever has the link of a set can take part, also in a private set: private means "not listed for other users", not "hidden from link holders".
- No server and no build step. Users are added from the page with Firebase Authentication's own mail; there is no mail service.
- The rules stay the real protection; what the page hides is for convenience only.
- Two users who have the same set open as presenter both steer the session, and the last click wins. That is the case between presenters today.

**H2, H3, H4 and H5 go live as one release**, between sessions: the rules of H4 need the user records of H2 and the owners of H3, and the page of H5 cannot list sets under the old rules. H6 to H8 can follow one by one. Until H8, users are added by hand: an account in the Firebase console plus a `users` record.

### H1. Set record, rights and the password rule as pure logic — S

> **Status: built on 23 Nov 2026**, in `js/core.js` with tests. Nothing calls it yet.

**Story.** As the builder I want ownership, visibility, sharing and the rights that follow from them in one tested place, so that the page, the demo store and the rules checklist all follow the same table.

**Specification**

- `normMeta` gives every set record three more fields: `owner` (a uid, or `null` for a set from before this epic), `visibility` (`private` unless it is exactly `public`) and `shared` (`{uid: true}`, never holding the owner).
- `duplicateSet(meta, cfg, now, owner)`: the copy belongs to `owner`, is private and is shared with nobody.
- `setRight(meta, user)` with `user = {uid, role}` gives `owner`, `admin`, `shared`, `viewer` (public set, other user) or `null`. `canManage`, `canControl`, `canAssign` and `canView` follow the table above. A user without a role (a signed-in account that has no `users` record, or an anonymous participant) has no right on any set.
- `sharedWith(meta)`, `withShare(meta, uid, on)` and `withOwner(meta, uid)` (the new owner leaves the shared list) change a record without touching the original.
- `passwordProblems(password, email)` gives the list of what is wrong, empty when the password is fine: at least 12 characters, at most 128, at least one letter and at least one character that is not a letter, not the email address or its name part, not one character repeated and not on a short list of well-known passwords. **Assumption:** these are the "standard rules"; see open decision 24.
- The questions file (export and "Create from file") carries none of the three fields: a file never decides who owns a set.

**AC**

- A record without the new fields reads as: no owner, private, shared with nobody.
- The rights table above holds for owner, shared user, other user, admin, a user without role and nobody, on a private and on a public set (tests).
- A duplicate of a public, shared set is private, not shared and owned by who made it.

**Depends on:** A1.

### H2. Users and roles — M

> **Status: built on 23 Nov 2026**, with tests against the stand-in for Firebase and tried in demo mode (as admin and with `&role=user`).
>
> Differences from the specification below:
> - **`isHost` is still there**, as another name for `isUser`: every user is presenter of every set until H5 decides it per set. The overview and the set screens are unchanged.
> - **The role is followed live**, not read once at sign-in: a record that is added, changed or removed works within a moment, without signing in again (needed for H7).
> - **The backend only reads the list of users** (`onUsers`). Writing it comes with H7 and H8.
> - **Demo:** the extra people and Sam's two sets are added once per browser, also to a demo store from before this item; its existing sets get the demo admin as owner. A participant tab (`&host=off`) keeps its own device id, so it is no longer the same record as the presenter tab.
> - The message for an account without a record now reads "This account has no access".

**Story.** As an admin I want a list of who may use this Tally Room and in which role, so that rights no longer depend on one shared presenter list.

**Specification**

- `users/{uid}` = `{email, name, role, createdAt}`, with `role` `admin` or `user`. It replaces `presenters/{uid}: true`. An account without a `users` record has no rights and gets today's "not on the list" message.
- Every user can read the whole list (names and email addresses), which the share dialog (H6) and the "shared with" pop-up need (open decision 22). Only an admin can write it; nobody can make themself admin. The first admin is written by hand in the Firebase console.
- The sign-in state of the backend gets `role` next to `uid` and `email`; `isHost` is replaced by `isUser` and `isAdmin`. Whether a device is presenter of a set is decided per set (H5).
- The demo backend is one made-up admin (`demo-admin`), so `?demo=1` keeps showing everything; `&role=user` shows the page as a normal user, with a second made-up user owning one public and one shared demo set.
- `tests/backend.test.js` covers the role in the sign-in state.

**AC**

- An account with `role: "user"` signs in and gets the overview; an account without a record gets the message and no sets.
- A user who writes `users/{own uid}/role` from the browser console is refused (with H4).
- Demo mode works without sign-in, as admin and with `&role=user`.

**Depends on:** G1, H1. Goes live together with H3, H4 and H5.

### H3. Migration of presenters and existing sets — S

> **Status: built on 23 Nov 2026**, with tests and tried in demo mode (a set without owner goes to the demo admin, with the note; a second load changes nothing). Not run against the real database.
>
> Differences from the specification below:
> - **New sets and duplicates get their owner from this item on** (the specification had that under H5): the rules of H4 refuse a set without owner from a normal user.
> - **The one-off migration of `MIGRATE_POLL_ID`** runs for an admin only and gives the migrated set that admin as owner.
> - The note names **Assign**, which comes with H7.
> - `presenters` is removed from the rules in H4; removing it from the data is a step in the setup guide.

**Story.** As the owner of the installation I want today's presenters and sets carried over, so that nothing is lost or left without an owner at the switch.

**Specification**

- Before the switch: a `users` record for each account in `presenters` (by hand in the console; there are only a few), with the installation's owner as `admin`. The old rules ignore these records.
- The switch: the new files and the rules of H4 are published together. The new page cannot read `users` under the old rules, so there is no order in which the old rules and the new page work together.
- After the switch: the first time an admin opens the overview, every set without `owner` gets that admin as owner, private and not shared (open decision 21). Until then such a set is managed by admins only, which the rules of H4 allow. The page says how many sets were taken over.
- `presenters` is removed from the database and from the rules once H4 is live.
- `tallyroom-setup.md` gets the upgrade steps in order: user records, new files and new rules together, first load by the admin.

**AC**

- After the first load by the admin no set is without owner.
- Running it again changes nothing.

**Depends on:** H1, H2.

### H4. Database rules for owners, sharing and roles — L

> **Status: built on 23 Nov 2026.** `database.rules.json` and the block in `tallyroom-setup.md` are rewritten; create, delete and change link are one write each. **Not tried on the real database:** the rules are not published, and `tests/rules-checklist.md` is still empty.
>
> Differences from the specification below:
> - **The rules are tested after all**, in `tests/rules.test.js`: a small stand-in for the way Firebase evaluates rules (cascading read and write, validation, updates of several paths, `newData`, queries) runs every row of the rights table for seven kinds of visitor. It is not Firebase, so the checklist stays, but as a short list of spot checks on the real database instead of the full table.
> - **An account reads its own `users` record**, also when it is no user (yet), so the page can follow a record that is added later.
> - **Sharing is only possible with a user**, the owner cannot be on the shared list, and an owner can only be an account with a `users` record: the rules check all three.
> - **A shared user removes itself** from `shared` and from `userSets` (Leave, H6); nobody else's entry.
> - **A free link is checked one set at a time** (`setExists`), because a user cannot read the list of all sets. Change link no longer looks for a leftover poll under the new link; such a poll cannot be read by a user and is overwritten.
> - **Change link onto a set the same user owns** is allowed by the rules; the page checks that the link is free.
> - README and the setup guide (first admin, upgrade steps, troubleshooting) are updated with this item instead of waiting for H9.

**Story.** As a user I want the database itself to keep my private sets mine, so that another user cannot read my answers or change my questions by going around the page.

**Specification**

- "User" in a rule: `users/{auth.uid}/role` exists. "Admin": it is `admin`. "Manages the set": admin, or `sets/{id}/owner` is the uid, or `sets/{id}/shared/{uid}` is `true`. "Controls the set": admin or owner.

| Path | Read | Write |
|---|---|---|
| `users` | Every user | Admin |
| `sets` as a list | Admin; a user only through the two queries below | Admin |
| `sets/{id}` | Every signed-in device, as today (a participant needs it) | Who controls it. Creating: a user, with `owner` its own uid |
| `sets/{id}/owner` | | Admin only, after creation |
| `sets/{id}/visibility`, `shared` | | Who controls it |
| other fields of `sets/{id}` | | Who manages it |
| `userSets/{uid}` | That user | |
| `userSets/{uid}/{id}` | | Who controls set `{id}`; the user itself may remove it |
| `polls/{id}` and below | Who manages the set; `config`, `session`, `shown`, `names` and the own vote as today | Who manages the set; participants as today |

- A user lists sets with two queries, which the rules allow by query: `orderByChild("owner").equalTo(own uid)` and `orderByChild("visibility").equalTo("public")`, with `.indexOn` for both. The sets shared with a user cannot be found by query, so they are listed in `userSets/{uid}/{setId}: true`, written in the same update as `sets/{id}/shared/{uid}`.
- `visibility` is `private` or `public`; `shared/{uid}` is `true`; a set cannot be created with another uid as owner.
- Writes that touch several paths are one update, and the rules look at the data as it will be (`newData`) where the old data cannot answer: creating a set together with its poll, **Change link**, and **Delete**. Today's delete removes the set and its poll in two writes; under these rules the second could be refused and leave a poll without a set.
- Everything of G3 to G5 for participants stays: the shape of a vote record, expiry, own record only.
- No automated test runs against real rules (that needs the Firebase emulator, and this repository installs nothing). `tests/rules-checklist.md` lists the cases to be tried in the Rules Playground and noted at each change of the rules.

**AC**

- Each row of the checklist, for: not signed in, anonymous participant, account without record, user (owner, shared, neither) and admin, on a private and a public set.
- A user cannot read `polls/{id}/votes` of another user's private or public set.
- A shared user can run a full session and cannot delete the set, change its link, its visibility or its sharing.
- An owner cannot give the set to someone else; an admin can.
- A full session with three phones runs without a refused write, as in G3.

**Depends on:** H1, H2, H3; replaces the presenter rules of G3, G4 and G5.

### H5. Rights per set in the page — L

> **Status: built on 23 Nov 2026**, with tests against the stand-in for Firebase and tried in demo mode: the overview of a user and of an admin, View, Duplicate, the private / public switch, and opening a shared set (presenter) and someone else's public set (participant). **Not tried:** the real database, and the "no longer have access" notice on screen (the backend test covers the right being taken away while the set is open).
>
> Differences from the specification below:
> - **View is a dialog on the overview**, not the question editor in read-only mode: the settings in one line and the list of questions with their type and scale or options, with **Duplicate to my sets**. It needed no changes to the editor.
> - **The admin's third section is called "All other sets"** and is left out when it is empty. "My sets" holds what the admin owns or was given.
> - **A set shared with you says so on its row** ("Shared with you by Sam"). The mark for the owner and the share dialog are H6.
> - **Private / Public** is a pill on the row that who controls the set can click (making public asks for confirmation), and a field in Settings. Others see it as a label.
> - **A user on someone else's set** gets a link back to their own sets in the participant top bar; on a public set also **Duplicate this set**, which opens the copy in the editor.
> - **Counts on the overview:** of a public set of someone else only the number of questions is shown; respondents and phase cannot be read.
> - **Presenter rights wait for the set record**: answers and actions are only asked for once the record has arrived and says this user manages the set.

**Story.** As a user I want an overview with my own sets and the public ones, so that I work in my own space and can still reuse what colleagues made public.

**Specification**

- The backend listens to three sources and merges them: own sets, `userSets/{uid}` with one listener per set in it, and public sets. An admin listens to all of `sets`. A set that is in the index but no longer exists is skipped.
- Whether this device is presenter of the open set follows `canManage` (H1) on the set record, and is decided again whenever that record or the sign-in changes: the listeners for answers and actions are attached and dropped with it. A user who loses access while the set is open gets "You no longer have access to this set" and the participant screen.
- A user who opens the link of a set they do not manage is a participant, and can vote (open decision 18). On a public set the top bar also offers **Duplicate**.
- Overview: **My sets** (own and shared with me, with today's actions as far as the right goes), **Public sets** (other people's: name, header, category, owner's name, number of questions; actions **View** and **Duplicate**) and, for an admin, **All sets** with the owner's name on each row.
- **View** opens the question editor read-only: questions and settings, no answers, no actions, no session controls (open decision 17).
- A new set is private and owned by who creates it. **Private / Public** is a switch on the row and in Settings, for who controls the set.
- **Duplicate** gives a private copy owned by who duplicates. **Delete** and **Change link** become one update each (H4).
- The demo backend follows the same rights, so the screens can be tried without Firebase.

**AC**

- User A does not see user B's private set anywhere; after B makes it public, A sees it under Public sets within a few seconds, can view and duplicate it, and cannot change it.
- A's duplicate is private, A's own, and independent of B's set.
- An admin sees every set and can do everything the owner can.
- Opening B's private link as user A gives the participant screen.

**Depends on:** H1 to H4; touches A2, A3, A8, G1.

### H6. Sharing a set with other users — M

> **Status: built on 23 Nov 2026**, with tests (core, both backends) and tried in demo mode as owner, as receiver and as admin, on the overview and from Settings on a set page. **Not tried:** the real database.
>
> Differences from the specification below:
> - **The field to add a user** is a text field with the list of users as suggestions ("Sam <sam@example.com>"). A name, a part of a name or an email address is enough when it points at one user; with more than one match the page asks for the full email address.
> - **Who it is shared with is also written on the row** ("Shared with Piet, Sam"), next to the **Shared** mark with the full line as hover text. For who controls the set the mark is a button that opens the share dialog.
> - **Settings** shows the line under "Who has access", with **Share…** or **Leave this set**. Share opens over Settings and comes back to it; what was typed in Settings is kept.
> - **Leave** asks for confirmation. On a set page it goes back to the overview.
> - **An admin can share a set with themself**; an admin who is on a shared list keeps the admin's actions, not Leave.
> - No change to the database rules: H4 already allows the two writes.

**Story.** As a user I want to give a colleague access to my set, so that I can prepare the questions and they can facilitate the session.

**Specification**

- **Share** on the row and in Settings, for who controls the set: a dialog with the users it is shared with (name, email, **Remove**) and a field to add a user from the list of users, by name or email.
- Adding and removing write `sets/{id}/shared/{uid}` and `userSets/{uid}/{id}` in one update. The owner is never on the list.
- A shared set shows a **Shared** mark on its row, for the owner, the people it is shared with and admins. Hovering shows "Owner: Anna. Shared with: Piet, Sam"; the same line is in the share dialog and in Settings, because a tablet has no hover.
- For the receiver the set sits under **My sets** from that moment, without reload, and behaves as their own except for what needs control (table above; open decision 19). Instead of Share they get **Leave**, which removes them from the list (open decision 20).
- The owner stays the owner. Duplicate never copies the list.
- Removing someone who has the set open as presenter takes their presenter rights at once (H5).

**AC**

- B shares a set with A: it appears in A's list within a few seconds, with the mark and both names.
- A edits a question, runs a session and exports the answers; A finds no Delete, Change link, Private / Public or Share on it.
- A leaves: the set is gone from A's list and B's row loses the mark.
- B's list shows which sets are shared and with whom, without opening them.

**Depends on:** H1, H2, H4, H5.

### H7. Admin: all sets and users — M

> **Status: built on 23 Nov 2026**, with tests (core, both backends, rules) and tried in demo mode: Assign from the row and from Settings, the Users screen, and a user's open overview turning into "This account has no access" when the admin removes them in another tab. **Not tried:** the real database.
>
> Differences from the specification below:
> - **The rules changed** (`database.rules.json` and the block in `tallyroom-setup.md`): the write rule of `users` moved from the list to the record, so that an admin cannot remove their own record or write a role other than `admin` into it. Another admin can. Publish the rules again.
> - **Users is a second screen of the overview**, behind a switch "Question sets | Users" that only an admin sees. It has no link of its own: a reload shows the question sets again.
> - **Change the name and switch role are one dialog** ("Change name or role"). On your own row the role is locked and Remove access is greyed out.
> - **Remove access looks through the sets as well as `userSets/{uid}`** for shared lists, in case the index missed one. The record and every entry go in one write.
> - **Assign to…** is also in Settings ("Who has access"). The dialog offers every user except the current owner.
> - **Demo:** the demo people are followed like real records, so a renamed or removed demo person follows in its own tab at once. A removed demo person cannot be put back from the page (adding users is H8); clear the site data of the browser to start over.

**Story.** As an admin I want to manage every set and the list of users, so that sets do not get stuck with someone who has left.

**Specification**

- On every set an admin has what the owner has, plus **Assign to…**: pick a user, who becomes owner; a new owner who was on the shared list is taken off it, and the previous owner keeps no rights unless the admin shares the set with them.
- Screen **Users** (admin only): name, email, role, number of own sets. Actions: change the name, switch role, **Remove access**.
- **Remove access** deletes the `users` record and takes the user off every shared list (found through `userSets/{uid}`). It is refused while the user still owns sets: assign those first. The account itself stays in Firebase Authentication and can only be deleted in the console (open decision 23); without a record it has no rights.
- An admin cannot remove or demote themself, so there is always one admin left. The console stays the way back in.

**AC**

- After **Assign to…** the set is under the new owner's My sets and no longer under the old owner's.
- A removed user who is still signed in loses the overview within a few seconds and gets the "not on the list" message.
- An admin cannot take away their own admin role.

**Depends on:** H2, H4, H5, H6.

### H8. Onboarding: invitation, first password, change password — M

> **Status: built on 23 Nov 2026**, with tests (core, both backends against the stand-in for Firebase) and tried in demo mode: Add user, the link, the Set password screen with the four refused passwords of the AC, a used link with Send me a new link, and Change password with a wrong current password. **Not tried:** anything against the real Firebase Authentication. No account was made through the second connection, no mail was sent, and the link of a real mail has not opened the page. The steps in the Firebase console (mail template with the action URL, password policy) are in `tallyroom-setup.md` 1b.5 and 1b.6 and still have to be done.
>
> Differences from the specification below:
> - **An address whose access was removed gets its old account back (added 23 Nov 2026, on request).** Firebase refuses to make an account a second time and the page cannot look up a uid by address, so Remove access now notes the account in `formerUsers/{uid}` (admins only; a new block in the rules, to be published). Add user first tries to make a new account; when Firebase says the address is in use, it looks in that list and restores `users/{uid}`. No invitation link then: the account keeps the password it had. An address with an account the page does not know (removed before this change, or made by hand) is still refused, with the way out.
> - **If the mail fails after the account and the record are made**, the user is added and the page says to use **Send invitation again**.
> - **"This link is no longer valid" asks for the email address**: a dead link no longer says who it was for. The answer is the same whether or not the address has an account. After a link that dies while the form is open, the address is filled in.
> - **What is still missing is shown while typing**, as a list under the first field, with the rule in one sentence above it. The two password fields keep what was typed when something is refused.
> - **After Set password the page signs in and replaces the address**, so the code is not left in the address bar or the history. If that sign-in fails, the sign-in screen follows.
> - **Change password** sits next to Sign out, on the overview and on the presenter screen of a set. A new password equal to the current one is refused.
> - **Password policy in Firebase:** the console has it under Authentication → Settings → Password policy (minimum length 6 to 30, mode Require or Notify). Whether this project shows it without the upgrade to Identity Platform could not be checked from here; the setup guide covers both cases. The page maps Firebase's refusal to "Firebase refused this password".
> - **App Check:** the second connection starts App Check too when a site key is set. Not tried with enforcement for Authentication.
> - **The mail carries a continue address** (the sign-in screen of the page). On this project the console refuses changes to the mail templates ("Email template updates are currently unavailable for this project", 23 Nov 2026), so the action URL cannot be set and the link opens Firebase's own page. That page then ends with **Continue** to the sign-in screen. Until Firebase lifts that, the Set password screen is not reached by a real mail, and a first or forgotten password is only held to Firebase's password policy; Change password keeps the page's rules. If Firebase refuses the continue address (domain not authorised), the mail is sent without it.
> - **The invitation link is the default, the mail optional (added 23 Nov 2026, on request).** After Add user the dialog stays open and shows a link to copy and send yourself, for example in WhatsApp. The mail is only sent when its checkbox is ticked, because its text cannot be changed on this project and it does not always arrive. Without a server the page cannot make a Firebase password link, so this link holds the email address and the random password of the new account, behind the `#` (not sent to a server or to a link preview). The invited user's page signs in with it on a second connection, only to set the chosen password; then the link is dead. This changes open decision 26: the random password is still not shown or stored, but it is in that link. The link does not expire until it is used, can only be copied in that dialog, and whoever has it can take the account. For an existing user there is none. Tested against the stand-in; not tried against real Firebase.
> - **Demo:** no mail. Add user, Send invitation again and Send me a new link show the link the mail would hold; passwords are kept in the demo store (the first current password is `demo`). Setting a password in demo mode does not sign in as that person: the page stays the demo admin or user.
> - No change to the database rules: an admin already writes `users/{uid}`.

**Story.** As an admin I want to add a colleague from the page, and as a user I want to choose and change my own password, so that nobody has to go into the Firebase console or pass a password around.

**Specification**

- **Add user** on the Users screen: name, email, role. The page creates the account through a second Firebase connection (a second app instance), so the admin stays signed in, with a random password of 32 characters that is never shown, stored or sent. It then writes the `users` record and lets Firebase send its password mail to the new address. That mail is the invitation. The random password is not mailed: the link replaces it, and a password in a mail can be read by anyone who gets at the mailbox.
- The mail template in the Firebase console (Authentication → Templates → Password reset) gets a text that fits both a new user and a forgotten password, and its action link points at the page.
- **Set password** screen, opened by the link (`?mode=resetPassword&oobCode=…`): shows the email address the link is for, two password fields and the rules of H1 with what is still missing. After saving, the user is signed in and lands on the overview.
- The link is valid for a short time (Firebase's setting, about an hour by default; check in the console). An expired or used link shows "This link is no longer valid" with **Send me a new link**. On the Users screen an admin has **Send invitation again**.
- **Change password** in the top bar: current password, new password twice, the same rules. The current password is checked first (Firebase asks for a recent sign-in).
- Passwords do not expire. The rules of H1 are checked in the page; Firebase's own password policy (Authentication → Settings) is set as close to them as it goes (minimum length 12), so the length also holds for someone who goes around the page. Whether the project offers that policy without an upgrade is checked during this item.
- Anyone can still create an account against the project's key, as today; without a `users` record it has no rights.
- With App Check enforced for Authentication the second connection needs App Check too; today it is enforced for the database only.

**AC**

- An admin adds an address; the mail arrives; the link opens the Set password screen; after choosing a password the new user sees an empty My sets and the public sets.
- The admin is still signed in as themself after adding a user.
- `password`, `aaaaaaaaaaaa`, a password of 11 characters and one of letters only are each refused with the reason.
- A link opened a second time gives "no longer valid" and a working **Send me a new link**.
- Change password with a wrong current password is refused without changing anything.

**Depends on:** H2, H7. Independent of H5 and H6: if it turns out harder than it looks, users keep being added by hand.

### H9. Documentation — S

> **Status: done on 23 Nov 2026.** README: "Who may do what" (users, sharing, admin, passwords), "Data layout" (`users`, `userSets`, the owner fields of `sets`), the files table and the demo paragraph. `tallyroom-setup.md`: step 1b rewritten (first admin by hand, the password mail with its action URL, the password policy, everyone else from the page), the usage section (My sets, Public sets, Share, Assign, Users), the upgrade steps and troubleshooting for mails, links and refused passwords; the rules block is the same text as `database.rules.json` (a test checks it). This backlog: a status note on every item of the epic, and open decision 2 closed. H4 had already done the rules block, the first admin and the upgrade steps of H3.

- README: "Who may do what" and "Data layout" follow this epic. `tallyroom-setup.md`: the new rules block, the first admin, the upgrade steps of H3, the mail template and password policy of H8. This backlog: status notes per item, and open decision 2 closed.

**Depends on:** each item updates its own part; this item is the final check.

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
2. **Presenter rights (A1).** One shared `HOST_KEY` gives access to all sets. "In parallel in different team settings" could also mean different presenters who should not see each other's sets; that needs a key per set or real sign-in, and is a separate item. AGREE. **CLOSED by Epic H (23 Nov 2026):** G1 brought real sign-in, and since Epic H every set has an owner, is private unless made public, and is managed only by its owner, the users it is shared with and admins.
3. **Expiry is not enforced by the database (A7).** Good enough for workshops; real enforcement needs rules that compare `now` with `expiresAt`. AGREE. (G3 adds that enforcement.)
4. **Decided: all purple follows the accent (A5).** Buttons, logo mark and bars, and also the faint page tint, borders and text tints. The alternative, a neutral grey page for every accent, is simpler but changes how today's purple sets look.
5. **No mixing of consent and dilemma in one set (B1).**  AGREE
6. **Saving an edit without text change starts a new vote (C1).** NO: after an edit without changes, just show the current question again and only proceed to the next question if the presenter clicks on Next Question
7. **Edit in batch mode (C1, C2).** Your description follows the one-at-a-time flow ("Next question"). I made it work in batch mode too; the alternative is to force consent sets into one-at-a-time mode, which is simpler. THE EDIT MODE ONLY NEEDS TO BE AVAILABLE IN ONE-AT-A-TIME MODE, SO DON'T BOTHER ADDING IT TO BATCH MODE
8. **Clear answers keeps edited texts (C2).** AGREE
9. **Named `yes`: duplicate names are refused (D1).** The alternative is to allow them and add a suffix ("Jan (2)"). AGREE
10. **Presenter can see who has not answered yet (D2).** Leave out if that feels like too much pressure on participants. MAKE IT AN OPTION FOR THE PRESENTER
11. **English defaults for new traffic light questions (Language).** New questions get "Consent / Concern / Objection" and English follow-up prompts instead of today's Dutch ones. If most of your consent sessions are Dutch, a per-set default (or keeping the Dutch defaults) saves retyping. AGREE
12. **Presenter sign-in with email and password (G1).** Accounts made by hand in the Firebase console. The alternative is Google or Microsoft sign-in, which saves a password but needs the provider set up and a pop-up or redirect on the laptop. AGREE
13. **Anonymous sign-in for participants (G2).** Invisible to the participant, and the only way the database can tell devices apart. The alternative is to leave participants unsigned and accept that one device can overwrite another's answers; G3 and G4 then protect sets, questions and sessions only. AGREE
14. **Readable links stay guessable (G4).** No random suffix on the slug. The alternative is a short random tail (`mt-offsite-x7k2`) on new sets, or a join code per set. ADD A SHORT RANDOM TAIL
15. **Hiding answers from other participants (G5).** Specified but optional: it is the largest item and changes how phones get their results. Decide per installation whether named or sensitive sets justify it. 
16. **No migration of answers at the switch (G2).** The switch to the new device ids is made between sessions; old records stay but belong to nobody. AGREE, NO PROBLEM
17. **Viewing a public set shows questions and settings only (H5).** Not the answers or follow-up actions of the owner's sessions. AGREE
18. **A user who opens someone else's set link is a participant (H5).** They can vote; on a public set they also get Duplicate. AGREE
19. **What a shared user may not do (H6).** Delete the set, change its link, switch private / public, or change who it is shared with. Everything else is allowed. AGREE
20. **A receiver can leave a shared set (H6).** AGREE
21. **Existing sets go to the first admin, private (H3).** The admin assigns them from there. AGREE
22. **Names and email addresses of all users are visible to all users (H2, H6).** The alternative is typing an exact email address to share. AGREE
23. **Removing a user removes the rights, not the account (H7).** The account can only be deleted in the Firebase console; the user's sets must be assigned first. AGREE
24. **Password rules (H1, H8).** At least 12 characters, at least one letter and one character that is not a letter, not the email address, not one repeated character, not a well-known password. No required capitals or symbols and no expiry: length does more than variety. The alternative is a shorter minimum with more required kinds of character.
25. **Private means not listed (H4, H5).** Whoever has the join link can take part and read the questions, as today. AGREE
26. **The invitation holds a link, not the password (H8).** The account gets a random password that nobody sees. CHANGED 23 Nov 2026: the admin can also copy an invitation link to send themself; that link carries the random password as a one-time key (see the status note of H8).

## Not in this backlog, but worth knowing

All three were done together with Epic A (20 Nov 2026):

- `index.html` and the files it loads are the only source; the README no longer refers to `tallyroom.html`.
- The single file is split into `config.js`, `css/styles.css`, `js/core.js` (pure logic), `js/backend.js` (data) and `js/app.js` (screens), still without a build step.
- `tests/core.test.js` (run with `node --test`) covers `js/core.js`. The rules for C1, C2 and D1 were written with their tests before those items were built: the status rule of C2 (`trafficStatus`), the revision filter of C1 (`answerIsCurrent`, `trafficCounts`) and the unique random names of D1 (`randomName`).
