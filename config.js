/* ======== YOUR SETTINGS ========
   1. FIREBASE_CONFIG: paste the config object from your Firebase project (Project settings > Your apps > Web app).
   2. HOST_KEY: a secret word. Open the page as  yourpage/?host=YOURSECRET  once to become the presenter on that device.
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
const HOST_KEY = "paars-offsite";
const MIGRATE_POLL_ID = "workshop-4";
