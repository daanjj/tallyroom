/* ======== YOUR SETTINGS ========
   1. FIREBASE_CONFIG: paste the config object from your Firebase project (Project settings > Your apps > Web app).
      Nothing in this file is a secret: who may do what is decided by sign-in and by the database rules
      (database.rules.json). Presenters sign in at  yourpage/?host  with an account from the Firebase console.
   2. APPCHECK_SITE_KEY: optional. The reCAPTCHA v3 site key of Firebase App Check (tallyroom-setup.md, step 1c).
      It is a public key, not a secret. Leave it empty ("") to run without App Check.
   3. MIGRATE_POLL_ID: only for a database from before question sets existed. The poll with this id is turned
      into a question set the first time a presenter opens the page. Leave it empty ("") for a new database. */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCN0pilBYUclgZI6kNQd4ns5N6VngWhLrw",
  authDomain: "tallyroom-72b2d.firebaseapp.com",
  databaseURL: "https://tallyroom-72b2d-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "tallyroom-72b2d",
  storageBucket: "tallyroom-72b2d.firebasestorage.app",
  messagingSenderId: "107998744016",
  appId: "1:107998744016:web:72bcb2dbc4e702a0857dd5"
};
const APPCHECK_SITE_KEY = "";
const MIGRATE_POLL_ID = "workshop-4";
