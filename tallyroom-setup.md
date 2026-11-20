# Tally Room, self-hosted version: setup guide

A small static site (`index.html`, `config.js` and the folders `css` and `js`) plus a free Firebase database for the live votes. Works for anyone with the link or QR code, no login, unlimited participants (Firebase's free plan allows 100 simultaneous connections). Total setup time: about 15 minutes, once.

## 1. Create the free database (Firebase)

1. Go to https://console.firebase.google.com and sign in with any Google account. Click **Add project**, give it a name (e.g. `tallyroom`), switch off Google Analytics, create.
2. In the left menu: **Databases and storage → Realtime Database** (under NoSQL; in older console layouts this is **Build → Realtime Database**), then **Create database**. Choose location **europe-west1 (Belgium)**. Choose **Start in locked mode**, then Enable.
3. Open the **Rules** tab and replace the content with:

```json
{
  "rules": {
    "sets": {
      ".read": true,
      ".write": true
    },
    "polls": {
      "$poll": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

Click **Publish**. `sets` is the list of question sets with their header, colour and expiry date; `polls` holds the questions and answers of each set. (These rules mean anyone with the page link can vote, which is what you want in a workshop.)

**Upgrading from the version with one poll:** your rules only have the `polls` block. Add the `sets` block and publish, before you put the new files online. Without it the page shows "The database does not allow reading question sets yet".

4. Copy the database URL shown at the top of the Data tab. It looks like `https://tallyroom-xxxxx-default-rtdb.europe-west1.firebasedatabase.app`.
5. Click **Settings → Project settings** in the left menu (or the **Add app** button on Project Overview) → **Your apps** → click the web icon `</>` → register the app (any nickname, no hosting needed) → copy the `firebaseConfig` block.

## 2. Put your settings in the file

Open `config.js` in a text editor (Notepad, TextEdit, VS Code). Fill in:

- `FIREBASE_CONFIG`: paste the values from step 1.5. Make sure `databaseURL` is filled in with the URL from step 1.4 (the console sometimes leaves it out).
- `HOST_KEY`: a secret word only you know, e.g. `paars2026`.
- `MIGRATE_POLL_ID`: leave it empty (`""`) for a new database. Only when you upgrade from the version with one poll: the old `POLL_ID` (e.g. `workshop-4`). The first time the presenter opens the page, that poll becomes a question set with the same questions and answers.

Save the file. There is no `POLL_ID` any more: question sets are created inside the tool.

## 3. Put the files online (free)

OneDrive and SharePoint cannot serve an HTML page as a website, so use one of these:

**Option A: GitHub Pages**
1. Create a free account at https://github.com, then a new **public** repository (e.g. `tallyroom`).
2. Upload `index.html`, `config.js` and the folders `css` and `js`, keeping the folder structure.
3. Repository **Settings → Pages → Source: Deploy from a branch → main → Save**. After a minute your page is live at `https://<yourname>.github.io/tallyroom/`.

**Option B: Netlify Drop**
1. Go to https://app.netlify.com/drop, create a free account, and drag the folder with `index.html`, `config.js`, `css` and `js` onto the page.
2. You get a link like `https://random-name.netlify.app`. You can rename it under Site settings.

To change questions or create sets later you do not need to re-upload: that happens inside the tool (they are stored in the database).

## 4. Question sets

- **Presenter**: open `https://your-link/?host=paars2026` once on your laptop (your own HOST_KEY). That browser is now the presenter for all question sets; from then on the plain link opens the overview of sets on that device. `?host=off` switches it back.
- **New question set** asks for a name (for your own overview), a header (what the audience sees), an accent colour, a category and an expiry date (3 days from now unless you change it). The category decides which question types the set offers: *Generic* has scale, multiple choice and open questions; *Consent* adds the traffic light; *Dilemma* adds the dilemma question (a choice plus a confidence rating). It then opens the question editor. **Create from file** starts the set from a questions file you exported earlier.
- **Named respondents** (in New question set and in Settings): *No* keeps everyone anonymous; *Yes* asks each participant for a name before joining; *Random* gives each device a name such as `k1`. With Yes or Random you see names with comments and open answers and in the exports.
- Each set has its own link (`https://your-link/?set=…`) and QR code. **Show QR** in the overview gives a large code, **Copy link** and **Download PNG** for slides or print.
- **More** per set: Settings, Other expiry date, Duplicate, Export questions, Export responses (JSON or CSV), Delete. These work without opening the set.
- **Expiry**: after the expiry moment participants see "This question set has expired" and can no longer answer; the presenter sees the set read-only. Nothing is deleted. **Extend** in the overview (or **Extend 3 days** in the set) switches it back on for every device within a few seconds.
- The plain link without `?set=` shows participants only "Scan the QR code or open the link you received". QR codes printed for the old single-poll version therefore no longer open a poll; hand out the code of the set.

## 5. Run a session

- Open the set from the overview. In the lobby choose the mode: *one question at a time* or *answer all first, then reveal*. Click **Edit questions** to change texts, types, scales and labels (each question has a **Type** list with the types of the set's category); the JSON import lets you paste a whole list at once. **Settings** changes the header, colour and expiry date, live on every device.
- **Participants**: scan the QR code of the set or open its link on their phone. Each device counts as one participant per set. Nothing to install, no login.
- **Back to lobby** sits in the top bar of the presenter view in every phase, so you can break off and restart at any moment. Answers are kept, so the lobby then also offers **Clear previous answers**. **All question sets** takes you back to the overview.
- Keyboard on the presenter laptop: → next, ← previous, space = reveal.
- **Save results (JSON)** and **CSV** sit in the lobby and on the summary screen as soon as there are answers. The JSON holds the set, the questions, the option labels, the per-question counts and every respondent's answers (anonymous, R01, R02, …); the CSV is one row per answer for a spreadsheet. Save before you clear, since clearing wipes the answers.
- **Open saved results** (lobby) loads a JSON you saved earlier. It opens in review mode: the presenter screen shows that run's questions and distributions, you can page through the questions, and nothing is written to the live set, so a session in progress is safe. **Publish to the room** replaces the live questions and answers with the imported ones for everyone; **Exit review** puts your screen back as it was. CSV is export only, since it cannot be read back without guessing.
- **Consent sets**: when a revealed proposal has a red vote, **Edit** lets you rewrite it; saving starts a new vote on that proposal on every device. **Finish** on the last question opens the closing overview: every proposal with its light, a Details tab for everything yellow or red, and **Export as Markdown**.
- **Clear all answers** starts a new round with the same questions, keeping everyone connected. In a consent set it also removes the lights and the earlier versions of edited proposals; the last text of each proposal stays.
- **Reset session** (lobby, right-hand side) is the hard one: answers cleared, round counter back to 1, and every device is shown a *Session was reset* screen with a **Join again** button. Until someone taps it that device stops counting, so the room fills up with the people actually present. A second sweep two seconds later catches answers that were already in flight. For a completely separate session, create a new set or duplicate this one.

## Costs and limits

Firebase Spark plan: free, no credit card, 1 GB storage and 100 simultaneous connections (over all sets together), far more than a workshop needs. GitHub Pages and Netlify's starter tier are free as well.

## Troubleshooting

- Page shows "Connecting…" forever: `databaseURL` missing or wrong in `config.js`, or rules not published.
- "The database does not allow reading question sets yet": the `sets` block is missing from the rules (step 1.3).
- "This question set does not exist (any more)": the set was deleted, or the link is incomplete. Take the link or QR code from the overview again.
- A phone stays on "Waiting for the presenter to start" after you open question 1: the page reconnects by itself (it forces a new connection when the screen comes back on and reads the session over plain HTTPS while waiting in the lobby), so give it a few seconds. A **Reconnecting…** pill in the top bar means the link is still down; refreshing always works.
- Votes do not appear on the presenter screen: participants are on the link of a different set, or the rules block writes. Check the Rules tab.
- Everybody sees the presenter view: someone opened the `?host=` link on a shared device. Open `?host=off` on that device.
- The page looks or behaves like the old version after an upload: the browser still has the old files. Reload once; if you change the files yourself, raise the `?v=` number behind the file names in `index.html`.
