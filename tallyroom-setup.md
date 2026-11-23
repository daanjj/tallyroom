# Tally Room, self-hosted version: setup guide

A small static site (`index.html`, `config.js` and the folders `css`, `js` and `vendor`) plus a free Firebase database for the live votes. Participants need only the link or QR code, no login; presenters sign in. Unlimited participants (Firebase's free plan allows 100 simultaneous connections). Total setup time: about 20 minutes, once.

## 1. Create the free database (Firebase)

1. Go to https://console.firebase.google.com and sign in with any Google account. Click **Add project**, give it a name (e.g. `tallyroom`), switch off Google Analytics, create.
2. In the left menu: **Databases and storage → Realtime Database** (under NoSQL; in older console layouts this is **Build → Realtime Database**), then **Create database**. Choose location **europe-west1 (Belgium)**. Choose **Start in locked mode**, then Enable.
3. Open the **Rules** tab and replace the content with the content of `database.rules.json` (the file in this folder is the source; this is the same text):

```json
{
  "rules": {
    "presenters": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid"
      }
    },
    "sets": {
      ".read": "auth != null && root.child('presenters').child(auth.uid).val() === true",
      ".write": "auth != null && root.child('presenters').child(auth.uid).val() === true",
      "$set": {
        ".read": "auth != null"
      }
    },
    "polls": {
      "$set": {
        ".read": "auth != null && root.child('presenters').child(auth.uid).val() === true",
        ".write": "auth != null && root.child('presenters').child(auth.uid).val() === true",
        "config": {
          ".read": "auth != null"
        },
        "session": {
          ".read": "auth != null"
        },
        "votes": {
          "$uid": {
            ".read": "auth != null && auth.uid === $uid",
            ".write": "auth != null && auth.uid === $uid && root.child('sets').child($set).exists() && (!root.child('sets').child($set).child('expiresAt').exists() || root.child('sets').child($set).child('expiresAt').val() > now)",
            ".validate": "newData.hasChildren(['round', 't'])",
            "round": {
              ".validate": "newData.isNumber()"
            },
            "t": {
              ".validate": "newData.isNumber() && newData.val() <= now + 60000"
            },
            "name": {
              ".validate": "newData.isString() && newData.val().length <= 30"
            },
            "nameAt": {
              ".validate": "newData.isNumber()"
            },
            "answers": {
              "$q": {
                ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 11 && $q.length <= 40 && $q.matches(/^[A-Za-z0-9_-]+$/) && (!root.child('polls').child($set).child('config').child('qids').exists() || root.child('polls').child($set).child('config').child('qids').child($q).val() === true || newData.val() === data.val())"
              }
            },
            "conf": {
              "$q": {
                ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 11 && $q.length <= 40 && $q.matches(/^[A-Za-z0-9_-]+$/) && (!root.child('polls').child($set).child('config').child('qids').exists() || root.child('polls').child($set).child('config').child('qids').child($q).val() === true || newData.val() === data.val())"
              }
            },
            "revs": {
              "$q": {
                ".validate": "newData.isNumber() && newData.val() >= 0 && $q.length <= 40 && $q.matches(/^[A-Za-z0-9_-]+$/) && (!root.child('polls').child($set).child('config').child('qids').exists() || root.child('polls').child($set).child('config').child('qids').child($q).val() === true || newData.val() === data.val())"
              }
            },
            "texts": {
              "$q": {
                ".validate": "newData.isString() && newData.val().length <= 2000 && $q.length <= 40 && $q.matches(/^[A-Za-z0-9_-]+$/) && (!root.child('polls').child($set).child('config').child('qids').exists() || root.child('polls').child($set).child('config').child('qids').child($q).val() === true || newData.val() === data.val())"
              }
            },
            "typing": {
              "$q": {
                ".validate": "newData.isNumber() && newData.val() <= now + 60000 && $q.length <= 40 && $q.matches(/^[A-Za-z0-9_-]+$/) && (!root.child('polls').child($set).child('config').child('qids').exists() || root.child('polls').child($set).child('config').child('qids').child($q).val() === true || newData.val() === data.val())"
              }
            },
            "$other": {
              ".validate": false
            }
          }
        },
        "shown": {
          ".read": "auth != null"
        },
        "names": {
          ".read": "auth != null",
          "$uid": {
            ".write": "auth != null && auth.uid === $uid && root.child('sets').child($set).exists() && (!root.child('sets').child($set).child('expiresAt').exists() || root.child('sets').child($set).child('expiresAt').val() > now)",
            ".validate": "newData.hasChildren(['n', 'at'])",
            "n": {
              ".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 30"
            },
            "at": {
              ".validate": "newData.isNumber()"
            },
            "$other": {
              ".validate": false
            }
          }
        }
      }
    }
  }
}
```

Click **Publish**. `sets` is the list of question sets with their header, colour and expiry date; `polls` holds the questions and answers of each set; `presenters` is the list of accounts that may present. In short: a presenter may read and write everything; a participant may read the one set of the link and write only its own answers, and only while the set exists and has not expired. Nobody can read or write anything without being signed in. Who has the Firebase CLI can publish with `firebase deploy --only database` instead.

**Upgrading to the version where participants cannot read each other's answers (21 Nov 2026):** publish the rules of step 1.3 and put the new files online together, between sessions. Old page with new rules, or new page with old rules: phones still vote, but show no results after a reveal. Phones that still have the old page open need a reload.

**Upgrading to the version that checks answers (21 Nov 2026):** publish the rules of step 1.3 again; the order does not matter. Answers must now be whole numbers from 0 to 11, and belong to a question of the set. A set gets its list of questions (`qids` in its config) the next time a presenter saves its questions; until then its answers are checked for shape only.

**Upgrading to the version with "still writing":** publish the rules of step 1.3 again first, then put the new files online. The rules gained one field (`typing`). With the old rules the new page still works, but the presenter does not see that someone is writing; the text is only held back until the participant pauses.

**Upgrading from the version with `HOST_KEY`:** do steps 1b and 1.3 and put the new files online in the same half hour, between sessions. The old page cannot write under the new rules, and the new page is not protected under the old ones. Export or reset running sets first: answers given before the switch stay readable but belong to no device any more, so a participant who returns would count twice. `HOST_KEY` is gone from `config.js`.

4. Copy the database URL shown at the top of the Data tab. It looks like `https://tallyroom-xxxxx-default-rtdb.europe-west1.firebasedatabase.app`.
5. Click **Settings → Project settings** in the left menu (or the **Add app** button on Project Overview) → **Your apps** → click the web icon `</>` → register the app (any nickname, no hosting needed) → copy the `firebaseConfig` block.

## 1b. Sign-in (Firebase Authentication)

Participants never see a sign-in: their phone signs in anonymously, which is how the database tells devices apart. Presenters sign in with email and password.

1. In the left menu: **Authentication → Get started → Sign-in method**. Switch on **Email/Password** (not the email link option) and **Anonymous**.
2. **Authentication → Users → Add user**: an email address and a password for each presenter. The page has no sign-up. Copy the **User UID** of the new user.
3. **Realtime Database → Data**: add a key `presenters`, and under it the UID as key with the value `true` (type boolean), so the data reads `presenters / {UID}: true`. Only the console can change this list; the page cannot.
4. **Authentication → Settings → Authorised domains**: add the domain of your page (`<yourname>.github.io` or your Netlify domain). `localhost` is there already.

Anonymous users pile up under Users, one per phone per browser. That is harmless; a project upgraded to Identity Platform can delete them automatically after 30 days.

## 1c. App Check (optional, later)

App Check makes the database accept requests from your page only, so a script elsewhere cannot use it with a self-made anonymous sign-in. It raises the effort for misuse; the rules of step 1.3 remain the real protection. Do this after at least one session has run well with the rules. Without it everything works as described.

It uses Google Cloud **Fraud Defense** (formerly reCAPTCHA Enterprise), score-based, which shows no puzzle. Firebase no longer accepts classic reCAPTCHA v3 keys for App Check; the console marks that option as deprecated. It loads a script from Google on every device and shows the small reCAPTCHA badge in a corner of the page; mention that where you have to account for third parties. Every phone asks for a new token about twice an hour, and each request counts as one assessment. Fraud Defense has a free monthly allowance; check the current pricing in the Google Cloud console. A two-hour session with 30 phones uses roughly 150 assessments.

1. Google Cloud console, https://console.cloud.google.com/security/recaptcha (the page is called **Fraud Defense**), with the project of your Firebase app selected at the top. Enable the **reCAPTCHA Enterprise API** when asked. Tab **Keys → Create key**: a **Display name** of your choice, **Application type: Web**, leave **Disable domain verification** off, and under **Domain list** add the domain of your page (`<yourname>.github.io`, without `https://` or a path; never `localhost`). Leave **Will you use challenges?** off: App Check needs a score-based key. Click **Create key** and copy the key ID from the list: that is the **site key**. There is no secret key.
2. Firebase console: **Security → App Check → Apps**. Open your web app, choose **reCAPTCHA Enterprise**, paste the **site key**, keep the token lifetime at 1 hour and the risk threshold at 0.5, and **Save**.
3. In `config.js`, put the **site key** in `APPCHECK_SITE_KEY` and put the file online. The site key is not a secret.
4. Run a session. Then look at **App Check → APIs → Realtime Database**: the graph should show nearly all requests as **verified**.
5. Only then click **Enforce** for Realtime Database. From that moment requests without a valid App Check token are refused. Leave Authentication unenforced unless you have checked its graph the same way.

**Working on `localhost`:** the Fraud Defense key is not registered for it, so the page asks Firebase for a debug token instead. Open the page on `localhost` with the browser console open; a line "App Check debug token: …" appears once per browser. Add that token under **App Check → Apps → your web app → ⋮ → Manage debug tokens**. Treat the token as a password and never put it in a file of this repository. Demo mode (`?demo=1`) does not touch Firebase and needs none of this.

To switch App Check off again: click **Unenforce** in the console first, then empty `APPCHECK_SITE_KEY`.

## 2. Put your settings in the file

Open `config.js` in a text editor (Notepad, TextEdit, VS Code). Fill in:

- `FIREBASE_CONFIG`: paste the values from step 1.5. Make sure `databaseURL` is filled in with the URL from step 1.4 (the console sometimes leaves it out).
- Nothing in `config.js` is a secret. Visitors download it; what they may do is decided by sign-in and the database rules.
- `APPCHECK_SITE_KEY`: leave it empty (`""`) unless you set up App Check in step 1c.
- `MIGRATE_POLL_ID`: leave it empty (`""`) for a new database. Only when you upgrade from the version with one poll: the old `POLL_ID` (e.g. `workshop-4`). The first time the presenter opens the page, that poll becomes a question set with the same questions and answers.

Save the file. There is no `POLL_ID` any more: question sets are created inside the tool.

## 3. Put the files online (free)

OneDrive and SharePoint cannot serve an HTML page as a website, so use one of these:

**Option A: GitHub Pages**
1. Create a free account at https://github.com, then a new **public** repository (e.g. `tallyroom`).
2. Upload `index.html`, `config.js` and the folders `css`, `js` and `vendor`, keeping the folder structure.
3. Repository **Settings → Pages → Source: Deploy from a branch → main → Save**. After a minute your page is live at `https://<yourname>.github.io/tallyroom/`.

**Option B: Netlify Drop**
1. Go to https://app.netlify.com/drop, create a free account, and drag the folder with `index.html`, `config.js`, `css`, `js` and `vendor` onto the page.
2. You get a link like `https://random-name.netlify.app`. You can rename it under Site settings.

To change questions or create sets later you do not need to re-upload: that happens inside the tool (they are stored in the database).

## 4. Question sets

- **Presenter**: open `https://your-link/?host` on your laptop and sign in with the account from step 1b (or use the small **Presenter sign-in** link on the plain page). The sign-in is remembered on that device; from then on the plain link opens the overview of sets. **Sign out** sits in the top bar; `?host=off` signs out too. **Forgot password** sends a reset mail.
- **New question set** asks for a name (for your own overview), a header (what the audience sees), an accent colour, a category and an expiry date (3 days from now unless you change it). The category decides which question types the set offers: *Generic* has scale, multiple choice and open questions; *Consent* adds the traffic light; *Dilemma* adds the dilemma question (a choice between exactly two options plus a confidence rating). It then opens the question editor. **Create from file** starts the set from a questions file you exported earlier.
- **Named respondents** (in New question set and in Settings): *No* keeps everyone anonymous; *Yes* asks each participant for a name before joining; *Random* gives each device a name such as `k1`. With Yes or Random you see names with comments and open answers and in the exports.
- Each set has its own link and QR code. The link ends in the name of the set as you typed it when creating it, plus four random characters (`https://your-link/?set=mt-offsite-team-b-x7k2`); renaming the set later does not change it. Anyone who knows or guesses the link of a set can join it and see the results shown to the room, which is why the random characters are there. **Show QR** in the overview gives a large code, **Copy link** and **Download PNG** for slides or print.
- **More** per set: Settings, Other expiry date, Change link, Duplicate, Export questions, Export responses (JSON or CSV), Delete. These work without opening the set.
- **Change link** gives a set another link, for example after a rename or for a set that still has an old or random link. Questions and answers move along, but the old link and QR code stop working and anyone who has the set open has to join again, so do this before a session and not during one.
- **Expiry**: after the expiry moment participants see "This question set has expired" and can no longer answer (the database refuses their answers, by its own clock); the presenter sees the set read-only. Nothing is deleted. **Extend** in the overview (or **Extend 3 days** in the set) switches it back on for every device within a few seconds.
- The plain link without `?set=` shows participants only "Scan the QR code or open the link you received". QR codes printed for the old single-poll version therefore no longer open a poll; hand out the code of the set.

## 5. Run a session

- Open the set from the overview. In the lobby choose the mode: *one question at a time* or *answer all first, then reveal*. Click **Edit questions** to change texts, types, scales and labels (each question has a **Type** list with the types of the set's category); the JSON import lets you paste a whole list at once. **Settings** changes the header, colour and expiry date, live on every device.
- **Participants**: scan the QR code of the set or open its link on their phone. Each device counts as one participant per set. Nothing to install, no login.
- **Back to lobby** sits in the top bar of the presenter view in every phase, so you can break off and restart at any moment. Answers are kept, so the lobby then also offers **Clear previous answers**. **Manage question sets** takes you back to the overview.
- Keyboard on the presenter laptop: → next, ← previous, space = reveal.
- **Save results (JSON)** and **CSV** sit in the lobby and on the summary screen as soon as there are answers. The JSON holds the set, the questions, the option labels, the per-question counts and every respondent's answers (anonymous, R01, R02, …); the CSV is one row per answer for a spreadsheet. Save before you clear, since clearing wipes the answers.
- **Open saved results** (lobby) loads a JSON you saved earlier. It opens in review mode: the presenter screen shows that run's questions and distributions, you can page through the questions, and nothing is written to the live set, so a session in progress is safe. **Publish to the room** replaces the live questions and answers with the imported ones for everyone; **Exit review** puts your screen back as it was. CSV is export only, since it cannot be read back without guessing.
- **Consent sets**: when a revealed proposal has a red vote, **Edit** lets you rewrite it; saving starts a new vote on that proposal on every device. **Finish** on the last question opens the closing overview: every proposal with its light, a Details tab for everything yellow or red, and **Export as Markdown**. The **Actions** tab lists every concern and objection with fields for a follow-up action, an owner and a deadline; it saves as you type and has its own **Export actions as Markdown**.
- **Clear all answers** starts a new round with the same questions, keeping everyone connected. In a consent set it also removes the lights, the recorded actions and the earlier versions of edited proposals; the last text of each proposal stays.
- **Reset session** (lobby, right-hand side) is the hard one: answers cleared, round counter back to 1, and every device is shown a *Session was reset* screen with a **Join again** button. Until someone taps it that device stops counting, so the room fills up with the people actually present. A second sweep two seconds later catches answers that were already in flight. For a completely separate session, create a new set or duplicate this one.

## Costs and limits

Firebase Spark plan: free, no credit card, 1 GB storage and 100 simultaneous connections (over all sets together), far more than a workshop needs. GitHub Pages and Netlify's starter tier are free as well.

## Troubleshooting

- Page shows "Connecting…" forever: `databaseURL` missing or wrong in `config.js`, or rules not published. Also when the folder `vendor` was not uploaded, or on a network that blocks WebSockets (the page connects through WebSockets only; try mobile data).
- Everything is refused right after you clicked **Enforce** for App Check: `APPCHECK_SITE_KEY` is empty or wrong in the `config.js` that is online, the domain is not on the reCAPTCHA key, or the secret key in the Firebase console belongs to another reCAPTCHA key. Click **Unenforce** to get going again, then check these three.
- Works online but not on `localhost` with App Check enforced: the debug token of that browser is not registered (step 1c).
- The browser console shows "violates the following Content Security Policy directive": the page tried to load or connect to something the policy in `index.html` does not list. A database on another host than `*.firebasedatabase.app` or `*.firebaseio.com` has to be added to `connect-src` there.
- "Could not connect. Check your connection and reload" on a phone: the **Anonymous** provider is off (step 1b), the phone blocks storage (some private modes), or there is no network.
- Votes are refused ("Your answer could not be saved"): the rules are published but the Anonymous provider is off, or the page online is still the old version.
- "This account is not a presenter": the UID of the account is not under `presenters` with the value `true` (step 1b.3), or the rules are not published yet.
- Signing in fails on the live page but works on `localhost`: the domain is missing under Authentication → Settings → Authorised domains.
- Change link reports "This set holds answers in an old format": the set holds answers from before the rules, with a field or a text the rules refuse. Export the answers, clear them, then change the link.
- "The database does not allow reading question sets yet": the rules of step 1.3 are not published.
- "This question set does not exist (any more)": the set was deleted, or the link is incomplete. Take the link or QR code from the overview again.
- A phone stays on "Waiting for the presenter to start" after you open question 1: the page reconnects by itself (it forces a new connection when the screen comes back on and reads the session over plain HTTPS while waiting in the lobby), so give it a few seconds. A **Reconnecting…** pill in the top bar means the link is still down; refreshing always works.
- Votes do not appear on the presenter screen: participants are on the link of a different set, or the rules block writes. Check the Rules tab.
- A shared device shows the presenter view: someone signed in on it. Click **Sign out**, or open `?host=off` on that device.
- The page looks or behaves like the old version after an upload: the browser still has the old files. Reload once; if you change the files yourself, raise the `?v=` number behind the file names in `index.html`.
