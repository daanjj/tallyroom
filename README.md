# Tally Room

Live polling for workshops, served as a static site (GitHub Pages) with a free Firebase database. One installation holds any number of **question sets**; each set has its own link, QR code, header, accent colour and expiry date, so several teams can use it at the same time. See `tallyroom-setup.md` for setup and usage, and `BACKLOG.md` for what is planned.

## Files

There is no build step: the browser loads these files as they are.

| File | What it holds |
|---|---|
| `index.html` | The page shell: it only loads the files below |
| `config.js` | Your settings: the Firebase project and, optionally, the App Check site key. No secret in it |
| `database.rules.json` | The database rules: who may read and write what. Published by hand in the Firebase console |
| `css/styles.css` | All styling. The purple values are the default accent |
| `js/core.js` | Pure logic: questions, statistics, exports, expiry, colour palette, rights on a set, the password rule. No screen, no network |
| `js/backend.js` | Where the data lives: Firebase, or a demo store inside the browser |
| `js/app.js` | Screens and actions |
| `tests/core.test.js` | Tests for `js/core.js` |
| `vendor/` | Third-party scripts, kept here so the page loads no script from another host (see below) |
| `tests/hardening.test.js` | Tests for the script sources, the security policy and the escaping in exports |
| `tests/fixtures/hostile-set.json` | A question set whose every text tries to inject HTML (see below) |
| `tests/backend.test.js` | Tests for `js/backend.js` (sign-in, roles, lists of sets, sharing, users, passwords), against a stand-in for Firebase |
| `tests/rules.test.js` | Tests for `database.rules.json`, against a stand-in for the way Firebase evaluates rules |
| `tests/rules-checklist.md` | What to try on the real database after publishing the rules |

## Trying it without touching the database

Add `?demo=1` to the address. The page then keeps its data in this browser only (shared between its tabs), you are the presenter without signing in (a made-up admin), and eight simulated participants answer. `&host=off` shows what a participant sees, and `&role=user` the page of a normal user. Demo mode sends no mail: where a mail would go out, the page shows the link it would hold.

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765/?demo=1`.

## Tests

```bash
node --test
```

Needs Node 18 or newer, nothing to install.

## Third-party scripts and the security policy

The page runs only scripts from its own folder, with one exception: when App Check is switched on (`APPCHECK_SITE_KEY` in `config.js`), Firebase loads the Fraud Defense (reCAPTCHA Enterprise) script from Google, which cannot be kept here. The policy lists the reCAPTCHA addresses for that; without the key nothing is loaded from them. `index.html` carries a Content Security Policy that allows scripts from the site itself, connections to the Firebase database and Firebase Authentication, images from the site and `data:` (the QR code), and Google Fonts for the typefaces. Inline scripts and `eval` are not allowed; inline styles are, because the page sets colours and sizes that way.

The files in `vendor/` are unchanged copies, fetched on 20 Nov 2026. To update one, download the new version from the same place, replace the file, and note the version and checksum here.

| File | Version | Source | SHA-256 |
|---|---|---|---|
| `qrcode.min.js` | qrcodejs 1.0.0 | `https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js` | `c541ef06327885a8415bca8df6071e14189b4855336def4f36db54bde8484f36` |
| `firebase-app-compat.js` | Firebase 10.12.0 | `https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js` | `367d0b9aef0a8c08717135c67d4bcc26a5d4a7103e228a1da7c33aedb91e285f` |
| `firebase-auth-compat.js` | Firebase 10.12.0 | `https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js` | `53de4f22563944851e5cbde4d89e930996b00301904adb69767d9e8b814c8247` |
| `firebase-app-check-compat.js` | Firebase 10.12.0 | `https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check-compat.js` | `3897630a79b188ddb4e69005057c63dae211a052a5887262d9f3e3d2166e0a19` |
| `firebase-database-compat.js` | Firebase 10.12.0 | `https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js` | `274e3b01a7b86dc52441f9d0980ba765b7df6e5eff6e2d05a5ae62980140eca8` |

The four Firebase files must stay on the same version. The database connection uses WebSockets only: Firebase's other way of connecting (long polling) loads scripts from the database host, which the policy does not allow.

### Hostile test set

`tests/fixtures/hostile-set.json` is a consent set with named respondents in which every text holds `<img src=x onerror=alert(1)>` or `"><script>alert(1)</script>`. After a change to the screens: open `?demo=1`, **New question set → Create from file**, run a session through every phase (type the same texts as name, comment, open answer, action and owner), and check that the texts are shown as typed, that no dialog appears and that the console shows no Content Security Policy violations.

In the exports, a CSV cell that starts with `=`, `+`, `-` or `@` gets an apostrophe in front so a spreadsheet does not run it as a formula, and the Markdown exports write `<` as `\<` and `|` in a table cell as `\|`.

## Who may do what

- **Users** sign in at `?host` with email and password, and have a record `users/{uid}` with the role `admin` or `user`. The first admin is made by hand in the Firebase console; everyone else is added by an admin from the **Users** screen. An admin manages every set. A user manages their own sets and the ones shared with them, and can read the questions of public sets. The overview shows My sets and Public sets (for an admin: all other sets). A user who opens the link of a set they do not manage takes part like any participant. The owner of a set, or an admin, shares it with other users from **Share…** (on the row and in Settings); who it is shared with can **Leave**. An admin can also give a set to another owner (**Assign to…**) and has the screen **Users**: change a name or a role, and **Remove access**, which is refused while the user still owns sets. An admin cannot remove or demote themself. Remove access leaves the sign-in account in Firebase; adding the same address again gives that account its access back.
- **Passwords**: **Add user** makes the account with a random password that nobody sees, and shows an invitation link to send to the new user; a mail from Firebase with a link is optional. The link in that mail opens the page's **Choose your password** screen (`?mode=resetPassword&oobCode=…`). The invitation link (`?mode=invite#e=…&k=…`) opens the same screen: it holds the address and that random password behind the `#`, exists only in the Add user dialog, and stops working once a password is chosen. Forgot password uses the same mail and screen. That needs the action URL of the mail template set to the page; where the Firebase console does not allow that, the link opens Firebase's own page, which ends with a Continue button to the sign-in screen. **Change password** asks for the current password first. A password has at least 12 characters, a letter and a non-letter, and is not the email address or a well-known password (`passwordProblems` in `js/core.js`); passwords do not expire. The page checks this; Firebase's own password policy holds the length for someone who goes around the page (`tallyroom-setup.md`, step 1b).
- **Participants** sign in anonymously, without noticing. The uid of that sign-in is the device id and the key of the vote record.
- `database.rules.json` enforces it: who manages a set (its owner, the users it is shared with, admins) reads and writes its questions, answers and actions, and only the owner or an admin deletes it, changes its link, its visibility or its sharing; a participant reads `sets/{id}`, `config`, `session`, `shown` and `names` of the set whose link it has, and of `votes` only its own record. It writes only `votes/{own uid}` and `names/{own uid}`, in a set that exists and has not expired. Answers are checked for shape: numbers from 0 to 11, only for the questions of the set (`config.qids`).
- **App Check** (optional, `tallyroom-setup.md` step 1c): with a site key in `config.js` and enforcement switched on in the console, the database accepts requests from this page only.
- **What the room sees** (G5): the presenter's screen publishes the answers of the revealed questions to `shown`, one record per answer, keyed so that records cannot be linked to a device or to each other. Phones only show results while a presenter screen has the set open, which is the case in every session.
- Not covered: in a named set, `names` (the names in use) can be read by every participant of that set; the answers cannot.

## Data layout

- `users/{uid}`: who may use this Tally Room (`role`: `admin` or `user`, `email`, `name`, `createdAt`). Read by every user, written by admins only; an admin cannot remove their own record or lower their own role. The accounts themselves, with their passwords, are in Firebase Authentication, not in the database.
- `formerUsers/{uid}`: the accounts whose access was removed (`email`, `name`, `removedAt`), read and written by admins only. Add user looks here when an address already has an account, and gives that account its access back.
- `userSets/{uid}/{setId}`: `true` for each set that is shared with that user, kept in step with `sets/{setId}/shared` so those sets can be listed.
- `sets/{setId}`: the attributes of a set (`name`, `header`, `accent`, `category`, `named`, `expiresAt`, `joinUrl`, `createdAt`, `updatedAt`) and who it belongs to: `owner` (a uid), `visibility` (`private` or `public`) and `shared` (`{uid: true}` for the users it is shared with). A user's overview is put together from the sets they own, the ones listed in `userSets` and the public ones; an admin reads the whole list.
- `polls/{setId}/config`: mode, follow-up prompts and the questions.
- `polls/{setId}/session`: where the session stands (phase, current question, round).
- `polls/{setId}/votes/{deviceId}`: one record per device (the device id is the uid of its sign-in), so a phone counts once per set. It holds `answers`, `texts` (comments and open answers), `conf` (dilemma confidence), `revs` (which version of an edited proposal an answer is for) and, in a named set, `name`.
- `polls/{setId}/shown/{questionId}_{n}`: what the room is shown, written by the presenter's screen: per revealed question, one record per answer (`answers`, and where relevant `texts`, `conf`, `revs`, `name`), with `t` as the order of answering. Empty before a reveal.
- `polls/{setId}/names/{deviceId}`: in a named set, the name a device uses (`n`, `at`), so names stay unique.
- `polls/{setId}/actions/{questionId}_{deviceId}_v{version}`: the follow-up action for one remark (`action`, `owner`, `due`, `none`), written by the presenter.
- Consent sets also use `session.outcome[questionId]` (the light of a proposal as it stood when the presenter left it), `session.revote` (a re-vote in progress) and, on an edited question, `rev` and `history` (earlier texts with their votes and comments).

## Named respondents

Per set (Settings → Named respondents):

- **No**: anonymous, as before. No name is stored.
- **Yes**: a participant types a name (2 to 30 characters, unique in the set) before joining, and can change it.
- **Random**: each device gets a name such as `k1` (one letter, one digit), unique in the set. 260 names are possible.

With Yes or Random the presenter sees names in front of comments and open answers, as chips under "In the room", and behind "Waiting for …" while answers come in. Exports use the name instead of `R01`. Charts stay aggregated.

## Consent sets

In a set of category Consent, traffic light questions are proposals:

- **Edit and vote again**: a revealed proposal with at least one yellow or red vote gets an **Edit** button. Saving a new text starts a new vote on that proposal for everyone; the old text, votes and comments are kept as an earlier version.
- **Final light**: when the presenter leaves a proposal (Next question or Finish) its light is fixed: red with any red vote, otherwise yellow with any yellow vote, otherwise green.
- **Closing overview**: after Finish, an Overview tab with every proposal and its light, and a Details tab with the yellow and red proposals, their comments and earlier versions.
- **Export as Markdown**: the outcome as a structured `.md` file (overview table, details, earlier versions, all proposals), with fixed English headings.
- **Actions**: a third tab in the closing overview with every yellow and red remark on the final versions. Per remark the presenter types a follow-up action, an owner and a deadline, or ticks "No action needed". It saves as you type, and **Export actions as Markdown** gives the list per proposal and by deadline. Only the presenter sees it.

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
- **Dilemma** (dilemma sets): `{"text": "…", "kind": "dilemma", "options": ["Build", "Buy"], "conf": {"text": "How confident are you in your choice?", "min": 1, "max": 5, "lo": "Not at all", "hi": "Very"}}`. A choice between exactly two options plus a confidence rating, sent together; a question with more options is multiple choice. The presenter sees per option the count, the share and the mean confidence, with the confidence distribution inside each bar.

Votes are stored as the option's position (1 = first option), so reordering options after people answered changes what their answers mean. An open answer is stored as text; a dilemma answer as the option's position plus the confidence value.

A questions file exported from the overview also carries a `set` block (`name`, `header`, `accent`, `category`, `named`); "New question set → Create from file" reads it back.
