# Tally Room, self-hosted version: setup guide

One HTML file (`tallyroom.html`) plus a free Firebase database for the live votes. Works for anyone with the link or QR code, no login, unlimited participants (Firebase's free plan allows 100 simultaneous connections). Total setup time: about 15 minutes, once.

## 1. Create the free database (Firebase)

1. Go to https://console.firebase.google.com and sign in with any Google account. Click **Add project**, give it a name (e.g. `tallyroom`), switch off Google Analytics, create.
2. In the left menu: **Databases and storage → Realtime Database** (under NoSQL; in older console layouts this is **Build → Realtime Database**), then **Create database**. Choose location **europe-west1 (Belgium)**. Choose **Start in locked mode**, then Enable.
3. Open the **Rules** tab and replace the content with:

```json
{
  "rules": {
    "polls": {
      "$poll": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

Click **Publish**. (These rules mean anyone with the page link can vote, which is what you want in a workshop. Use a fresh `POLL_ID` per session, see step 2.)

4. Copy the database URL shown at the top of the Data tab. It looks like `https://tallyroom-xxxxx-default-rtdb.europe-west1.firebasedatabase.app`.
5. Click **Settings → Project settings** in the left menu (or the **Add app** button on Project Overview) → **Your apps** → click the web icon `</>` → register the app (any nickname, no hosting needed) → copy the `firebaseConfig` block.

## 2. Put your settings in the file

Open `tallyroom.html` in a text editor (Notepad, TextEdit, VS Code). Near the top you will find a block marked **YOUR SETTINGS**. Fill in:

- `FIREBASE_CONFIG`: paste the values from step 1.5. Make sure `databaseURL` is filled in with the URL from step 1.4 (the console sometimes leaves it out).
- `POLL_ID`: any word, e.g. `cmc-offsite-oct`. Change it for each new session to start with an empty poll; old sessions stay in the database.
- `HOST_KEY`: a secret word only you know, e.g. `paars2026`.

Save the file.

## 3. Put the file online (free)

OneDrive and SharePoint cannot serve an HTML page as a website, so use one of these:

**Option A: GitHub Pages**
1. Create a free account at https://github.com, then a new **public** repository (e.g. `tallyroom`).
2. Upload `tallyroom.html` and rename it to `index.html` during upload.
3. Repository **Settings → Pages → Source: Deploy from a branch → main → Save**. After a minute your page is live at `https://<yourname>.github.io/tallyroom/`.

**Option B: Netlify Drop**
1. Go to https://app.netlify.com/drop, create a free account, and drag a folder containing `index.html` (the renamed file) onto the page.
2. You get a link like `https://random-name.netlify.app`. You can rename it under Site settings.

To update the questions later you do not need to re-upload: edit them inside the tool (they are stored in the database).

## 4. Run a session

- **Presenter**: open `https://your-link/?host=paars2026` once on your laptop (your own HOST_KEY). That browser is now the presenter for this poll; from then on the plain link also opens the presenter view on that device. `?host=off` switches it back.
- In the lobby choose the mode: *one question at a time* or *answer all first, then reveal*. Click **Edit questions** to change texts, scales and labels; the JSON import lets you paste a whole list at once.
- **Participants**: scan the QR code or open the plain link on their phone. Each device counts as one participant. Nothing to install, no login.
- **Back to lobby** sits in the top bar of the presenter view in every phase, so you can break off and restart at any moment. Answers are kept, so the lobby then also offers **Clear previous answers**.
- Keyboard on the presenter laptop: → next, ← previous, space = reveal.
- **Clear all answers** starts a new round with the same questions, keeping everyone connected.
- **Reset session** (lobby, right-hand side) is the hard one: answers cleared, round counter back to 1, and every device is shown a *Session was reset* screen with a **Join again** button. Until someone taps it that device stops counting, so the room fills up with the people actually present. A second sweep two seconds later catches answers that were already in flight. For a completely separate session, change `POLL_ID` in the file and re-upload, or just clear and reuse.

## Costs and limits

Firebase Spark plan: free, no credit card, 1 GB storage and 100 simultaneous connections, far more than a workshop needs. GitHub Pages and Netlify's starter tier are free as well.

## Troubleshooting

- Page shows "Connecting…" forever: `databaseURL` missing or wrong in the settings block, or rules not published.
- A phone stays on "Waiting for the presenter to start" after you open question 1: the page reconnects by itself (it forces a new connection when the screen comes back on and reads the session over plain HTTPS while waiting in the lobby), so give it a few seconds. A **Reconnecting…** pill in the top bar means the link is still down; refreshing always works.
- Votes do not appear on the presenter screen: participants are on a different `POLL_ID` (old cached version) or the rules block writes. Check the Rules tab.
- Everybody sees the presenter view: someone opened the `?host=` link on a shared device. Open `?host=off` on that device.
