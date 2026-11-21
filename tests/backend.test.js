/* Run with:  node --test
   Covers the sign-in logic of js/backend.js (backlog G1, G2) against a stand-in for the Firebase SDK.
   It does not test the database rules: those are checked in the Firebase console (see BACKLOG.md, G3 and G4). */
const test = require("node:test");
const assert = require("node:assert/strict");

const tick = () => new Promise((r) => setTimeout(r, 5));
function fakeStorage(init) { const m = new Map(Object.entries(init || {}));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), has: (k) => m.has(k) }; }
/* data = the database; presenters = uids on the list; user = who is signed in when the page loads */
function fakeFirebase({ data = {}, user = null, anonFails = false, noAppCheck = false } = {}) {
  const log = { on: [], off: [], anon: 0, out: 0 }; let authCb = null, cur = user, n = 0;
  const get = (path) => path.split("/").reduce((o, k) => (o == null ? o : o[k]), data);
  const setUser = (u) => { cur = u; setTimeout(() => authCb && authCb(cur), 0); };
  const auth = { get currentUser() { return cur; }, onAuthStateChanged: (f) => { authCb = f; setTimeout(() => f(cur), 0); },
    signInAnonymously: async () => { log.anon++; if (anonFails) throw Object.assign(new Error("off"), { code: "auth/operation-not-allowed" }); setUser({ uid: "anon" + ++n, isAnonymous: true }); },
    signInWithEmailAndPassword: async (email, pw) => { if (pw !== "good") throw Object.assign(new Error("bad"), { code: "auth/invalid-credential" }); setUser({ uid: "u_" + email.split("@")[0], isAnonymous: false, email }); },
    signOut: async () => { log.out++; setUser(null); }, sendPasswordResetEmail: async () => {} };
  const db = { ref: (path) => ({ on: (ev, cb) => { if (path && path[0] !== ".") { log.on.push(path); setTimeout(() => cb({ val: () => get(path) ?? null }), 0); } return cb; },
    off: () => log.off.push(path), once: async () => ({ val: () => get(path) ?? null }),
    set: async (v) => (log.set = log.set || []).push([path, v]), child: (p) => db.ref(path + "/" + p) }) };
  const appCheck = () => ({ activate: (p, refresh) => log.appCheck.push([p instanceof appCheck.ReCaptchaEnterpriseProvider ? "enterprise:" + p.siteKey : p, refresh, global.FIREBASE_APPCHECK_DEBUG_TOKEN === true]), getToken: async () => ({ token: "ac-token" }) });
  appCheck.ReCaptchaEnterpriseProvider = class { constructor(k) { this.siteKey = k; } };
  log.appCheck = [];
  return { log, firebase: { initializeApp() {}, database: () => db, auth: () => auth, ...(noAppCheck ? {} : { appCheck }) } };
}
function load(opts, storage, query, anon, appCheckKey) {
  const fb = fakeFirebase(opts); global.firebase = fb.firebase; global.localStorage = storage || fakeStorage(); global.TRCore = require("../js/core.js");
  delete require.cache[require.resolve("../js/backend.js")];
  const be = require("../js/backend.js").make({ firebaseConfig: { apiKey: "k", databaseURL: "https://x.example" }, params: new URLSearchParams(query || ""), anon, appCheckKey });
  const states = []; be.onAuth((a) => states.push(a)); return { be, states, log: fb.log };
}
const DATA = { presenters: { u_ann: true }, sets: { a: { name: "A" } }, polls: { a: { config: { mode: "live" }, actions: { k: { action: "x" } } } } };

test("a participant on a set page is signed in anonymously and the uid is the device id", async () => {
  const { be, states, log } = load({ data: DATA }, null, "set=a", true); await tick();
  assert.equal(log.anon, 1); assert.equal(be.id, "anon1"); assert.equal(be.isHost, false);
  assert.deepEqual(states.map((s) => [s.uid, s.isHost, s.anon]), [["anon1", false, true]]);
});
test("without a set nobody is signed in by the page", async () => {
  const { be, states, log } = load({ data: DATA }, null, "", false); await tick();
  assert.equal(log.anon, 0); assert.equal(be.id, null); assert.equal(states.length, 1); assert.equal(states[0].isHost, false);
});
test("an account on the presenters list is presenter; another account is not", async () => {
  const a = load({ data: DATA, user: { uid: "u_ann", isAnonymous: false, email: "ann@x.nl" } }, null, "", false); await tick();
  assert.equal(a.be.isHost, true); assert.equal(a.be.id, "u_ann");
  const b = load({ data: DATA, user: { uid: "u_bob", isAnonymous: false, email: "bob@x.nl" } }, null, "", false); await tick();
  assert.equal(b.be.isHost, false); assert.equal(b.states[0].anon, false); assert.equal(b.states[0].email, "bob@x.nl");
});
test("signing in turns the device into the presenter; a wrong password does not", async () => {
  const { be } = load({ data: DATA }, null, "host=1", false); await tick();
  await assert.rejects(be.signIn("ann@x.nl", "bad")); assert.equal(be.isHost, false);
  await be.signIn("ann@x.nl", "good"); await tick(); assert.equal(be.isHost, true);
});
test("?host=off signs a presenter out", async () => {
  const { be, log } = load({ data: DATA, user: { uid: "u_ann", isAnonymous: false } }, null, "host=off", false); await tick();
  assert.equal(log.out, 1); assert.equal(be.isHost, false); assert.equal(be.id, null);
});
test("signing out on a set page makes the presenter an anonymous participant, and the listeners follow", async () => {
  const { be, log } = load({ data: DATA, user: { uid: "u_ann", isAnonymous: false } }, null, "set=a", true); await tick();
  const p = be.poll("a"), seen = { cfg: 0, actions: [] };
  p.onConfig(() => seen.cfg++); p.onActions((a) => seen.actions.push(Object.keys(a).length)); await tick();
  assert.deepEqual(log.on, ["polls/a/config", "polls/a/actions"]); assert.deepEqual(seen.actions, [1]);
  await be.signOut(); await tick();
  assert.equal(be.isHost, false); assert.equal(be.id, "anon1");
  assert.deepEqual(log.on, ["polls/a/config", "polls/a/actions", "polls/a/config"]); // the actions are not listened to any more
  assert.deepEqual(seen.actions, [1, 0]); assert.equal(seen.cfg, 2);
});
test("a failed anonymous sign-in is reported, not hidden", async () => {
  const { be, states } = load({ data: DATA, anonFails: true }, null, "set=a", true); await tick();
  assert.equal(be.id, null); assert.equal(states.at(-1).error, "anon");
});
test("the old presenter flag and device id are removed from the device", async () => {
  const st = fakeStorage({ tr_host: "1", tr_host_workshop: "1", tr_pid: "p_old", tr_qs: "1", tr_name_a: "{}" });
  load({ data: DATA }, st, "", false); await tick();
  assert.deepEqual(["tr_host", "tr_host_workshop", "tr_pid", "tr_qs", "tr_name_a"].map((k) => st.has(k)), [false, false, false, true, true]);
});
test("App Check starts only with a site key, and plain HTTPS reads carry its token", async () => {
  delete global.FIREBASE_APPCHECK_DEBUG_TOKEN; delete global.location;
  const off = load({ data: DATA }, null, "", false, ""); await tick(); assert.deepEqual(off.log.appCheck, []);
  const calls = []; global.fetch = async (url, o) => { calls.push([url, o]); return { ok: true, json: async () => ({ config: 1 }) }; };
  const on = load({ data: DATA, user: { uid: "u_ann", isAnonymous: false, getIdToken: async () => "id-token" } }, null, "", false, " site-key "); await tick();
  assert.deepEqual(on.log.appCheck, [["enterprise:site-key", true, false]]); // Fraud Defense provider, token kept fresh, no debug token away from localhost
  await on.be.readPoll("a");
  assert.match(calls[0][0], /^https:\/\/x\.example\/polls\/a\.json\?auth=id-token&/); assert.equal(calls[0][1].headers["X-Firebase-AppCheck"], "ac-token");
  calls.length = 0; const plain = load({ data: DATA, user: { uid: "u_ann", isAnonymous: false, getIdToken: async () => "id-token" } }, null, "", false, ""); await tick();
  await plain.be.readPoll("a"); assert.equal(calls[0][1].headers, undefined);
});
test("App Check on localhost asks for a debug token; a page without the App Check script runs without it", async () => {
  global.location = { hostname: "localhost" };
  const local = load({ data: DATA }, null, "", false, "site-key"); await tick(); assert.deepEqual(local.log.appCheck, [["enterprise:site-key", true, true]]);
  delete global.FIREBASE_APPCHECK_DEBUG_TOKEN; delete global.location;
  const none = load({ data: DATA, noAppCheck: true }, null, "set=a", true, "site-key"); await tick(); assert.equal(none.be.id, "anon1");
});
test("demo mode has no sign-in: presenter unless ?host=off", async () => {
  global.localStorage = fakeStorage(); global.addEventListener = () => {};
  delete require.cache[require.resolve("../js/backend.js")]; const B = require("../js/backend.js");
  const a = B.make({ firebaseConfig: {}, params: new URLSearchParams("demo=1") }), b = B.make({ firebaseConfig: {}, params: new URLSearchParams("demo=1&host=off") });
  assert.equal(a.isHost, true); assert.equal(b.isHost, false); assert.ok(a.id); let s = null; a.onAuth((x) => (s = x)); assert.equal(s.isHost, true);
});
test("every config written to Firebase carries the ids of its questions, for the rules to check answers against", async () => {
  const { be, log } = load({ data: DATA, user: { uid: "u_ann", isAnonymous: false } }, null, "", false); await tick();
  const cfg = { mode: "live", questions: [{ id: "qabc123", text: "x" }, { id: "bad/id", text: "y" }] };
  await be.writePoll("a", { config: cfg, session: {} }); await be.poll("a").setConfig(cfg);
  assert.deepEqual(log.set.map(([p, v]) => [p, (v.config || v).qids]), [["polls/a", { qabc123: true }], ["polls/a/config", { qabc123: true }]]);
  assert.equal(cfg.qids, undefined, "the caller's object is left alone");
});
test("a participant listens to its own record, what is shown and the names, never to all votes; a presenter to all votes", async () => {
  const part = load({ data: DATA }, null, "set=a", true); await tick();
  const p = part.be.poll("a"), got = {}; p.onVotes((v) => (got.all = v)); p.onMine((v) => (got.mine = v)); p.onShown((v) => (got.shown = v)); p.onNames((v) => (got.names = v)); await tick();
  assert.deepEqual(part.log.on, ["polls/a/votes/anon1", "polls/a/shown", "polls/a/names"]); assert.deepEqual(got.all, {});
  const host = load({ data: DATA, user: { uid: "u_ann", isAnonymous: false } }, null, "set=a", true); await tick();
  const h = host.be.poll("a"); h.onVotes(() => {}); h.onMine(() => {}); h.onShown(() => {}); h.onNames(() => {}); await tick();
  assert.deepEqual(host.log.on, ["polls/a/votes"]);
});
test("a participant's catch-up read asks only for the parts it may read", async () => {
  const calls = []; global.fetch = async (url) => { calls.push(url.split(".json")[0].replace("https://x.example/", "")); return { ok: true, json: async () => ({}) }; };
  const { be } = load({ data: DATA, user: { uid: "anonX", isAnonymous: true, getIdToken: async () => "t" } }, null, "set=a", true); await tick();
  const d = await be.poll("a").pull();
  assert.deepEqual(calls.sort(), ["polls/a/config", "polls/a/names", "polls/a/session", "polls/a/shown", "polls/a/votes/anonX"]); assert.equal(d.mine, null);
});
