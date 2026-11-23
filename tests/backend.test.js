/* Run with:  node --test
   Covers the sign-in logic of js/backend.js (backlog G1, G2, H2) against a stand-in for the Firebase SDK.
   It does not test the database rules: those are checked in the Firebase console (see BACKLOG.md, G3 and G4). */
const test = require("node:test");
const assert = require("node:assert/strict");

const tick = () => new Promise((r) => setTimeout(r, 5));
function fakeStorage(init) { const m = new Map(Object.entries(init || {}));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), has: (k) => m.has(k) }; }
/* data = the database; data.users = who may sign in, with their role; user = who is signed in when the page loads */
function fakeFirebase({ data = {}, user = null, anonFails = false, noAppCheck = false } = {}) {
  const log = { on: [], off: [], anon: 0, out: 0 }; let authCb = null, cur = user, n = 0; const live = [];
  const get = (path) => path.split("/").reduce((o, k) => (o == null ? o : o[k]), data);
  const setUser = (u) => { cur = u; setTimeout(() => authCb && authCb(cur), 0); };
  const auth = { get currentUser() { return cur; }, onAuthStateChanged: (f) => { authCb = f; setTimeout(() => f(cur), 0); },
    signInAnonymously: async () => { log.anon++; if (anonFails) throw Object.assign(new Error("off"), { code: "auth/operation-not-allowed" }); setUser({ uid: "anon" + ++n, isAnonymous: true }); },
    signInWithEmailAndPassword: async (email, pw) => { if (pw !== "good") throw Object.assign(new Error("bad"), { code: "auth/invalid-credential" }); setUser({ uid: "u_" + email.split("@")[0], isAnonymous: false, email }); },
    signOut: async () => { log.out++; setUser(null); }, sendPasswordResetEmail: async () => {} };
  /* the listener on users/{uid} is the sign-in itself, so it has its own log; log.on holds the listeners the page asked for */
  const db = { ref: (path) => ({ on: (ev, cb) => { if (path && path[0] !== ".") { (path.startsWith("users/") ? (log.user = log.user || []) : log.on).push(path); live.push([path, cb]); setTimeout(() => cb({ val: () => get(path) ?? null }), 0); } return cb; },
    off: (ev, cb) => { log.off.push(path); const i = live.findIndex((l) => l[1] === cb); if (i >= 0) live.splice(i, 1); }, once: async () => ({ val: () => get(path) ?? null }),
    set: async (v) => (log.set = log.set || []).push([path, v]), child: (p) => db.ref(path + "/" + p) }) };
  const appCheck = () => ({ activate: (p, refresh) => log.appCheck.push([p instanceof appCheck.ReCaptchaEnterpriseProvider ? "enterprise:" + p.siteKey : p, refresh, global.FIREBASE_APPCHECK_DEBUG_TOKEN === true]), getToken: async () => ({ token: "ac-token" }) });
  appCheck.ReCaptchaEnterpriseProvider = class { constructor(k) { this.siteKey = k; } };
  log.appCheck = [];
  /* a change in the database, as the server would push it to who listens */
  const change = (path, v) => { const ks = path.split("/"), last = ks.pop(); let o = data; ks.forEach((k) => (o = o[k] = o[k] || {})); if (v == null) delete o[last]; else o[last] = v;
    live.filter((l) => l[0] === path).forEach((l) => l[1]({ val: () => get(path) ?? null })); };
  return { log, change, firebase: { initializeApp() {}, database: () => db, auth: () => auth, ...(noAppCheck ? {} : { appCheck }) } };
}
function load(opts, storage, query, anon, appCheckKey) {
  const fb = fakeFirebase(opts); global.firebase = fb.firebase; global.localStorage = storage || fakeStorage(); global.TRCore = require("../js/core.js");
  delete require.cache[require.resolve("../js/backend.js")];
  const be = require("../js/backend.js").make({ firebaseConfig: { apiKey: "k", databaseURL: "https://x.example" }, params: new URLSearchParams(query || ""), anon, appCheckKey });
  const states = []; be.onAuth((a) => states.push(a)); return { be, states, log: fb.log, change: fb.change };
}
const DATA = { users: { u_ann: { email: "ann@x.nl", name: "Ann", role: "user" }, u_adm: { email: "adm@x.nl", role: "admin" }, u_odd: { email: "odd@x.nl", role: "presenter" } }, presenters: { u_bob: true }, sets: { a: { name: "A" } }, polls: { a: { config: { mode: "live" }, actions: { k: { action: "x" } } } } };

test("a participant on a set page is signed in anonymously and the uid is the device id", async () => {
  const { be, states, log } = load({ data: DATA }, null, "set=a", true); await tick();
  assert.equal(log.anon, 1); assert.equal(be.id, "anon1"); assert.equal(be.isHost, false);
  assert.deepEqual(states.map((s) => [s.uid, s.isHost, s.anon]), [["anon1", false, true]]);
});
test("without a set nobody is signed in by the page", async () => {
  const { be, states, log } = load({ data: DATA }, null, "", false); await tick();
  assert.equal(log.anon, 0); assert.equal(be.id, null); assert.equal(states.length, 1); assert.equal(states[0].isHost, false);
});
test("an account with a users record is a user or an admin; an account without one has no rights", async () => {
  const who = (uid) => load({ data: JSON.parse(JSON.stringify(DATA)), user: { uid, isAnonymous: false, email: uid.slice(2) + "@x.nl" } }, null, "", false);
  const a = who("u_ann"); await tick();
  assert.deepEqual([a.be.id, a.be.role, a.be.isUser, a.be.isAdmin, a.be.isHost], ["u_ann", "user", true, false, true]);
  assert.deepEqual([a.states[0].role, a.states[0].name, a.states[0].isUser, a.states[0].isAdmin], ["user", "Ann", true, false]);
  const adm = who("u_adm"); await tick();
  assert.deepEqual([adm.be.role, adm.be.isUser, adm.be.isAdmin, adm.states[0].name], ["admin", true, true, "adm"]);
  for (const uid of ["u_bob", "u_odd"]) { // only on the old presenters list, or with a role that does not exist
    const b = who(uid); await tick();
    assert.deepEqual([b.be.role, b.be.isUser, b.be.isAdmin, b.be.isHost], [null, false, false, false], uid);
    assert.equal(b.states[0].anon, false); assert.equal(b.states[0].email, uid.slice(2) + "@x.nl");
  }
});
test("a role that is given, changed or taken away works at once, without signing in again", async () => {
  const { be, states, change, log } = load({ data: JSON.parse(JSON.stringify(DATA)), user: { uid: "u_new", isAnonymous: false, email: "new@x.nl" } }, null, "", false); await tick();
  const sets = []; be.onSets((s) => sets.push(s && Object.keys(s))); await tick();
  assert.equal(be.isUser, false); assert.deepEqual(log.on, [], "no rights: the list of sets is not asked for");
  change("users/u_new", { email: "new@x.nl", role: "user" }); await tick();
  assert.deepEqual([be.role, be.isAdmin], ["user", false]); assert.deepEqual(log.on, ["sets"]); assert.deepEqual(sets.at(-1), ["a"]);
  change("users/u_new", { email: "new@x.nl", role: "admin" }); await tick(); assert.deepEqual([be.role, be.isAdmin], ["admin", true]);
  change("users/u_new", null); await tick(); assert.deepEqual([be.role, be.isUser, be.isHost], [null, false, false]);
  assert.deepEqual(states.map((s) => s.role), [null, "user", "admin", null]);
});
test("the user record is not followed any more after signing out; a participant has no role", async () => {
  const { be, change, log } = load({ data: JSON.parse(JSON.stringify(DATA)), user: { uid: "u_ann", isAnonymous: false } }, null, "set=a", true); await tick();
  assert.deepEqual(log.user, ["users/u_ann"]); await be.signOut(); await tick();
  assert.ok(log.off.includes("users/u_ann")); assert.deepEqual([be.id, be.role, be.isUser], ["anon1", null, false]);
  change("users/u_ann", { role: "admin" }); await tick(); assert.equal(be.isAdmin, false); assert.deepEqual(log.user, ["users/u_ann"]);
});
test("the list of users is for users only", async () => {
  const u = load({ data: DATA, user: { uid: "u_ann", isAnonymous: false } }, null, "", false); await tick();
  let got = null; u.be.onUsers((m) => (got = m)); await tick(); assert.deepEqual(Object.keys(got), ["u_ann", "u_adm", "u_odd"]);
  const p = load({ data: DATA }, null, "set=a", true); await tick();
  let none = null; p.be.onUsers((m) => (none = m)); await tick(); assert.deepEqual(none, {}); assert.ok(!p.log.on.includes("users"));
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
test("demo mode: the page is a made-up admin, or a user with &role=user; a participant is neither", async () => {
  global.localStorage = fakeStorage(); global.addEventListener = () => {};
  delete require.cache[require.resolve("../js/backend.js")]; const B = require("../js/backend.js"), mk = (q) => B.make({ firebaseConfig: {}, params: new URLSearchParams(q) });
  const adm = mk("demo=1"), usr = mk("demo=1&role=user"), part = mk("demo=1&host=off&role=user"), st = (b) => { let s = null; b.onAuth((x) => (s = x)); return s; };
  assert.deepEqual([adm.id, adm.role, adm.isUser, adm.isAdmin, st(adm).uid, st(adm).name], ["demo-admin", "admin", true, true, "demo-admin", "Demo admin"]);
  assert.deepEqual([usr.id, usr.role, usr.isUser, usr.isAdmin, usr.isHost], ["demo-user", "user", true, false, true]);
  assert.deepEqual([part.role, part.isUser, part.isAdmin, part.isHost, st(part).uid], [null, false, false, false, null]); assert.match(part.id, /^p_/);
  let users = null; adm.onUsers((m) => (users = m)); assert.deepEqual(Object.keys(users), ["demo-admin", "demo-user", "demo-sam"]);
  let none = null; part.onUsers((m) => (none = m)); assert.deepEqual(none, {});
  const C = global.TRCore || require("../js/core.js"), sets = await adm.getSets(), me = { uid: "demo-user", role: "user" };
  assert.deepEqual(Object.keys(sets).map((id) => [C.normMeta(sets[id]).owner, C.setRight(sets[id], me)]), [["demo-admin", null], ["demo-sam", "viewer"], ["demo-sam", "shared"]]);
});
test("demo mode: a demo store from before users existed gets the demo people and an owner on its sets, once", async () => {
  const old = { sets: { mine01: { name: "Mine" } }, polls: { mine01: { config: { questions: [] } } } };
  global.localStorage = fakeStorage({ tr_demo_db: JSON.stringify(old) }); global.addEventListener = () => {};
  delete require.cache[require.resolve("../js/backend.js")]; const B = require("../js/backend.js"), mk = () => B.make({ firebaseConfig: {}, params: new URLSearchParams("demo=1") });
  const a = mk(), s1 = await a.getSets(); assert.equal(s1.mine01.owner, "demo-admin"); assert.deepEqual(Object.keys(s1), ["mine01", "demo0002", "demo0003"]);
  await a.removeSet("demo0002"); const s2 = await mk().getSets(); assert.deepEqual(Object.keys(s2), ["mine01", "demo0003"], "removed sets do not come back");
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
