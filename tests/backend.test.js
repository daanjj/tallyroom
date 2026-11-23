/* Run with:  node --test
   Covers the sign-in logic of js/backend.js (backlog G1, G2, H2) against a stand-in for the Firebase SDK.
   It does not test the database rules: those are checked in the Firebase console (see BACKLOG.md, G3 and G4). */
const test = require("node:test");
const assert = require("node:assert/strict");

const tick = () => new Promise((r) => setTimeout(r, 25)); // long enough for a chain of timers on a busy machine
function fakeStorage(init) { const m = new Map(Object.entries(init || {}));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), has: (k) => m.has(k) }; }
/* data = the database; data.users = who may sign in, with their role; user = who is signed in when the page loads */
function fakeFirebase({ data = {}, user = null, anonFails = false, noAppCheck = false } = {}) {
  const log = { on: [], off: [], anon: 0, out: 0 }; let authCb = null, cur = user, n = 0; const live = [];
  const get = (path) => path.split("/").reduce((o, k) => (o == null ? o : o[k]), data);
  const setUser = (u) => { cur = u; setTimeout(() => authCb && authCb(cur), 0); };
  /* a second connection (addUser): its own sign-in state, which never touches the one of the page */
  const second = (name) => { const a2 = { setPersistence: async (p) => log.second.push(["persistence", p]), createUserWithEmailAndPassword: async (email, pw) => { log.second.push(["create", email, pw]); if (email.startsWith("taken@")) throw Object.assign(new Error("in use"), { code: "auth/email-already-in-use" }); return { user: { uid: "u_" + email.split("@")[0] } }; },
    signOut: async () => log.second.push(["signOut"]) }; return { auth: () => a2, delete: async () => log.second.push(["delete", name.split("-")[0]]) }; };
  log.second = []; log.mail = [];
  const auth = { get currentUser() { return cur; }, verifyPasswordResetCode: async (c) => { if (c !== "good") throw Object.assign(new Error("old"), { code: "auth/expired-action-code" }); return "new@x.nl"; },
    confirmPasswordReset: async (c, pw) => { if (c !== "good") throw Object.assign(new Error("old"), { code: "auth/invalid-action-code" }); log.confirmed = [c, pw]; }, onAuthStateChanged: (f) => { authCb = f; setTimeout(() => f(cur), 0); },
    signInAnonymously: async () => { log.anon++; if (anonFails) throw Object.assign(new Error("off"), { code: "auth/operation-not-allowed" }); setUser({ uid: "anon" + ++n, isAnonymous: true }); },
    signInWithEmailAndPassword: async (email, pw) => { if (pw !== "good") throw Object.assign(new Error("bad"), { code: "auth/invalid-credential" }); setUser({ uid: "u_" + email.split("@")[0], isAnonymous: false, email }); },
    signOut: async () => { log.out++; setUser(null); }, sendPasswordResetEmail: async (email, settings) => { log.mail.push(email); (log.mailWith = log.mailWith || []).push(settings || null); if (settings && /blocked/.test(settings.url)) throw Object.assign(new Error("domain"), { code: "auth/unauthorized-continue-uri" }); if (email.startsWith("nomail@")) throw Object.assign(new Error("quota"), { code: "auth/quota-exceeded" }); } };
  const authNs = Object.assign(() => auth, { Auth: { Persistence: { NONE: "none" } }, EmailAuthProvider: { credential: (email, pw) => ({ email, pw }) } });
  /* the listener on users/{uid} is the sign-in itself, so it has its own log; log.on holds the listeners the page asked for */
  /* a query on a list: the children whose field has that value; listed in the logs as sets?owner=u_ann */
  const filtered = (path, k, v) => { const o = get(path) || {}, out = {}; Object.keys(o).forEach((id) => { if (o[id] && o[id][k] === v) out[id] = o[id]; }); return Object.keys(out).length ? out : null; };
  const query = (path, k, v) => { const name = path + "?" + k + "=" + v; return { on: (ev, cb) => { log.on.push(name); live.push([path, cb, () => filtered(path, k, v)]); setTimeout(() => cb({ val: () => filtered(path, k, v) }), 0); return cb; },
    off: (ev, cb) => { log.off.push(name); const i = live.findIndex((l) => l[1] === cb); if (i >= 0) live.splice(i, 1); } }; };
  const db = { ref: (path) => ({ orderByChild: (k) => ({ equalTo: (v) => query(path, k, v) }), on: (ev, cb) => { if (path && path[0] !== ".") { (path.startsWith("users/") ? (log.user = log.user || []) : log.on).push(path); live.push([path, cb]); setTimeout(() => cb({ val: () => get(path) ?? null }), 0); } return cb; },
    off: (ev, cb) => { log.off.push(path); const i = live.findIndex((l) => l[1] === cb); if (i >= 0) live.splice(i, 1); }, once: async () => ({ val: () => get(path) ?? null }),
    set: async (v) => (log.set = log.set || []).push([path, v]), update: async (v) => (log.update = log.update || []).push([path || "", v]), child: (p) => db.ref(path + "/" + p) }) };
  const appCheck = () => ({ activate: (p, refresh) => log.appCheck.push([p instanceof appCheck.ReCaptchaEnterpriseProvider ? "enterprise:" + p.siteKey : p, refresh, global.FIREBASE_APPCHECK_DEBUG_TOKEN === true]), getToken: async () => ({ token: "ac-token" }) });
  appCheck.ReCaptchaEnterpriseProvider = class { constructor(k) { this.siteKey = k; } };
  log.appCheck = [];
  /* a change in the database, as the server would push it to who listens */
  const change = (path, v) => { const ks = path.split("/"), last = ks.pop(); let o = data; ks.forEach((k) => (o = o[k] = o[k] || {})); if (v == null) delete o[last]; else o[last] = v;
    live.filter((l) => l[0] === path || path.startsWith(l[0] + "/")).forEach((l) => l[1]({ val: () => (l[2] ? l[2]() : get(l[0]) ?? null) })); };
  return { log, change, firebase: { initializeApp: (cfg, name) => (name ? second(name) : undefined), database: () => db, auth: authNs, ...(noAppCheck ? {} : { appCheck }) } };
}
function load(opts, storage, query, anon, appCheckKey) {
  const fb = fakeFirebase(opts); global.firebase = fb.firebase; global.localStorage = storage || fakeStorage(); global.TRCore = require("../js/core.js");
  delete require.cache[require.resolve("../js/backend.js")];
  const be = require("../js/backend.js").make({ firebaseConfig: { apiKey: "k", databaseURL: "https://x.example" }, params: new URLSearchParams(query || ""), anon, appCheckKey });
  const states = []; be.onAuth((a) => states.push(a)); return { be, states, log: fb.log, change: fb.change };
}
const DATA = { users: { u_ann: { email: "ann@x.nl", name: "Ann", role: "user" }, u_piet: { email: "piet@x.nl", role: "user" }, u_adm: { email: "adm@x.nl", role: "admin" }, u_odd: { email: "odd@x.nl", role: "presenter" } }, presenters: { u_bob: true }, sets: { a: { name: "A", owner: "u_ann" } }, polls: { a: { config: { mode: "live" }, actions: { k: { action: "x" } } } } };

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
  assert.deepEqual([be.role, be.isAdmin], ["user", false]); assert.deepEqual(log.on, ["sets?owner=u_new", "sets?visibility=public", "userSets/u_new"]); assert.deepEqual(sets.at(-1), [], "a new user owns nothing yet");
  change("users/u_new", { email: "new@x.nl", role: "admin" }); await tick(); assert.deepEqual([be.role, be.isAdmin], ["admin", true]);
  assert.equal(log.on.at(-1), "sets"); assert.deepEqual(sets.at(-1), ["a"], "an admin reads the whole list");
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
  let got = null; u.be.onUsers((m) => (got = m)); await tick(); assert.deepEqual(Object.keys(got), ["u_ann", "u_piet", "u_adm", "u_odd"]);
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
  assert.deepEqual(log.on, ["sets/a", "polls/a/config", "polls/a/actions"]); assert.deepEqual(seen.actions, [1]);
  await be.signOut(); await tick();
  assert.equal(be.isHost, false); assert.equal(be.id, "anon1");
  assert.deepEqual(log.on, ["sets/a", "polls/a/config", "polls/a/actions", "sets/a", "polls/a/config"]); // the actions are not listened to any more
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
test("creating, deleting and moving a set are one write each, and take the share index along", async () => {
  const data = JSON.parse(JSON.stringify(DATA)); data.sets.a = { name: "A", owner: "u_ann", shared: { u_adm: true, u_x: true } };
  const { be, log } = load({ data, user: { uid: "u_ann", isAnonymous: false } }, null, "", false); await tick();
  assert.equal(await be.setExists("a"), true); assert.equal(await be.setExists("nope"), false);
  await be.createSet("b", { name: "B", owner: "u_ann" }, { config: { mode: "live", questions: [{ id: "q1", text: "x" }] }, session: { phase: "lobby" } });
  assert.deepEqual(log.update[0], ["", { "sets/b": { name: "B", owner: "u_ann" }, "polls/b": { config: { mode: "live", questions: [{ id: "q1", text: "x" }], qids: { q1: true } }, session: { phase: "lobby" } } }]);
  await be.removeSet("a");
  assert.deepEqual(log.update[1], ["", { "sets/a": null, "polls/a": null, "userSets/u_adm/a": null, "userSets/u_x/a": null }]);
  await be.moveSet("a", "c");
  assert.deepEqual(log.update[2], ["", { "sets/c": data.sets.a, "polls/c": data.polls.a, "sets/a": null, "polls/a": null, "userSets/u_adm/c": true, "userSets/u_adm/a": null, "userSets/u_x/c": true, "userSets/u_x/a": null }]);
  await assert.rejects(be.moveSet("nope", "d"), /does not exist/); data.sets.taken = { name: "T" }; await assert.rejects(be.moveSet("a", "taken"), /already in use/);
  assert.equal(log.update.length, 3);
});
test("sharing a set and leaving it are one write each: the shared list and the index of that user (H6)", async () => {
  const { be, log } = load({ data: JSON.parse(JSON.stringify(DATA)), user: { uid: "u_ann", isAnonymous: false } }, null, "", false); await tick();
  await be.shareSet("a", "u_piet", true); await be.shareSet("a", "u_piet", false);
  assert.deepEqual(log.update, [["", { "sets/a/shared/u_piet": true, "userSets/u_piet/a": true }], ["", { "sets/a/shared/u_piet": null, "userSets/u_piet/a": null }]]);
});
test("demo mode: the owner shares and unshares, the receiver sees the set at once and can leave; nobody else changes the list (H6)", async () => {
  global.localStorage = fakeStorage(); global.addEventListener = () => {};
  delete require.cache[require.resolve("../js/backend.js")]; const B = require("../js/backend.js"), mk = (q) => B.make({ firebaseConfig: {}, params: new URLSearchParams(q) });
  const adm = mk("demo=1"), usr = mk("demo=1&role=user"), C = global.TRCore, lists = []; usr.onSets((x) => lists.push(Object.keys(x).sort().join()));
  await usr.createSet("mine01", { name: "Mine", owner: usr.id }, { config: { questions: [] }, session: {} });
  await usr.shareSet("mine01", "demo-sam", true); assert.deepEqual(C.sharedWith((await usr.getSets()).mine01), ["demo-sam"]);
  await usr.shareSet("mine01", usr.id, true); assert.deepEqual(C.sharedWith((await usr.getSets()).mine01), ["demo-sam"], "the owner is never on the list");
  await assert.rejects(usr.shareSet("mine01", "nobody", true), /does not exist/); await assert.rejects(usr.shareSet("nope", "demo-sam", true), /does not exist/);
  await usr.shareSet("mine01", "demo-sam", false); assert.deepEqual(C.sharedWith((await usr.getSets()).mine01), []);
  await assert.rejects(usr.shareSet("demo0003", "demo-admin", true), /cannot change/, "shared with the user: no control");
  await assert.rejects(usr.shareSet("demo0002", "demo-user", true), /cannot change/, "a public set of someone else");
  const rights = []; usr.poll("demo0003").onRight((r) => rights.push(r));
  await usr.shareSet("demo0003", usr.id, false); assert.equal(rights.at(-1), false, "left: no longer presenter"); assert.equal(lists.at(-1), "demo0002,mine01");
  await assert.rejects(usr.shareSet("demo0003", usr.id, false), /cannot change/);
  await adm.shareSet("demo0003", "demo-user", true); assert.deepEqual(C.sharedWith((await adm.getSets()).demo0003), ["demo-user"], "an admin shares any set");
});
test("assign, change a user and remove a user are one write each; an admin cannot remove or demote themself (H7)", async () => {
  const data = JSON.parse(JSON.stringify(DATA)); data.sets = { a: { name: "A", owner: "u_ann", shared: { u_piet: true } }, b: { name: "B", owner: "u_adm", shared: { u_piet: true } }, c: { name: "C", owner: "u_piet" } }; data.userSets = { u_piet: { a: true } };
  const { be, log } = load({ data, user: { uid: "u_adm", isAnonymous: false } }, null, "", false); await tick();
  await be.assignSet("a", "u_piet");
  assert.deepEqual(log.update[0], ["", { "sets/a/owner": "u_piet", "sets/a/shared/u_piet": null, "userSets/u_piet/a": null }], "the new owner leaves the shared list");
  await be.setUser("u_ann", { name: " Ann  B ", role: "admin", email: "other@x.nl" });
  assert.deepEqual(log.update[1], ["users/u_ann", { name: "Ann B", role: "admin" }]);
  await be.setUser("u_adm", { name: "Admin" }); assert.deepEqual(log.update[2], ["users/u_adm", { name: "Admin" }], "the own name");
  await assert.rejects(be.setUser("u_adm", { role: "user" }), /own admin role/); await assert.rejects(be.removeUser("u_adm"), /own access/);
  await assert.rejects(be.removeUser("u_piet"), /piet still owns 1 question set/, "its sets are assigned first");
  delete data.sets.c; await be.removeUser("u_piet");
  assert.deepEqual(log.update[3], ["", { "users/u_piet": null, "userSets/u_piet/a": null, "sets/a/shared/u_piet": null, "userSets/u_piet/b": null, "sets/b/shared/u_piet": null }]);
  assert.equal(log.update.length, 4);
});
test("demo mode: an admin assigns a set, renames and removes a user; the page of that user follows at once (H7)", async () => {
  const store = fakeStorage(); global.localStorage = store; const onStorage = []; global.addEventListener = (ev, f) => onStorage.push(f);
  delete require.cache[require.resolve("../js/backend.js")]; const B = require("../js/backend.js"), mk = (q) => B.make({ firebaseConfig: {}, params: new URLSearchParams(q) });
  const adm = mk("demo=1"), usr = mk("demo=1&role=user"), C = global.TRCore, tell = () => onStorage.forEach((f) => f({ key: "tr_demo_db" })); // what the browser does for the other tabs
  const states = []; usr.onAuth((a) => states.push([a.name, a.role, a.isHost])); const lists = []; usr.onSets((x) => lists.push(Object.keys(x).sort().join()));
  await assert.rejects(usr.assignSet("demo0003", "demo-user"), /Only an admin/); await assert.rejects(usr.setUser("demo-user", { role: "admin" }), /Only an admin/); await assert.rejects(usr.removeUser("demo-sam"), /Only an admin/);
  await adm.assignSet("demo0003", "demo-user"); tell();
  let m = (await adm.getSets()).demo0003; assert.equal(m.owner, "demo-user"); assert.deepEqual(C.sharedWith(m), [], "the new owner is off the shared list");
  assert.equal(C.setRight(m, { uid: "demo-sam", role: "user" }), null, "the previous owner keeps no rights");
  await assert.rejects(adm.assignSet("demo0003", "nobody"), /does not exist/);
  await adm.setUser("demo-user", { name: "Renamed" }); tell(); assert.deepEqual(states.at(-1), ["Renamed", "user", true]);
  await assert.rejects(adm.setUser("demo-admin", { role: "user" }), /own admin role/); await assert.rejects(adm.removeUser("demo-admin"), /own access/);
  await assert.rejects(adm.removeUser("demo-user"), /Renamed still owns 1 question set/);
  await adm.assignSet("demo0003", "demo-sam"); await adm.shareSet("demo0003", "demo-user", true); await adm.removeUser("demo-user"); tell();
  assert.deepEqual(C.sharedWith((await adm.getSets()).demo0003), [], "taken off every shared list");
  assert.deepEqual(states.at(-1), ["", null, false], "no record any more: no rights"); assert.equal(usr.isHost, false); assert.equal(usr.isUser, false); assert.equal(lists.at(-1), "");
  let users = null; adm.onUsers((u) => (users = Object.keys(u).sort())); assert.deepEqual(users, ["demo-admin", "demo-sam"]);
});
test("add user: the account is made through a second connection with a random password, then the record and the mail; the admin stays signed in (H8)", async () => {
  global.crypto = global.crypto || require("node:crypto").webcrypto;
  const { be, log, states } = load({ data: JSON.parse(JSON.stringify(DATA)), user: { uid: "u_adm", isAnonymous: false, email: "adm@x.nl" } }, null, "", false); await tick();
  const out = await be.addUser({ name: " New  One ", email: "new@x.nl", role: "user", extra: 1 });
  assert.deepEqual(out, { uid: "u_new", mailed: true });
  assert.deepEqual(log.second.map((x) => x[0]), ["persistence", "create", "signOut", "delete"]); assert.deepEqual(log.second[0], ["persistence", "none"], "nothing of the new account is kept on the device");
  const pw = log.second[1][2]; assert.equal(pw.length, 32); assert.deepEqual(global.TRCore.passwordProblems(pw, "new@x.nl"), []);
  const [path, rec] = log.set.at(-1); assert.equal(path, "users/u_new"); assert.deepEqual({ ...rec, createdAt: 0 }, { email: "new@x.nl", name: "New One", role: "user", createdAt: 0 }); assert.ok(Math.abs(rec.createdAt - Date.now()) < 5000);
  assert.deepEqual(log.mail, ["new@x.nl"]); assert.ok(!JSON.stringify([log.set, log.mail]).includes(pw), "the password is not stored or sent");
  assert.equal(log.out, 0); assert.equal(be.id, "u_adm"); assert.equal(states.at(-1).uid, "u_adm");
  assert.deepEqual(await be.addUser({ name: "No Mail", email: "nomail@x.nl", role: "admin" }), { uid: "u_nomail", mailed: false }, "the record is there; the invitation can be sent again");
  assert.equal(log.set.at(-1)[1].role, "admin");
  const sets = log.set.length; await assert.rejects(be.addUser({ name: "Taken", email: "taken@x.nl" }), (e) => e.code === "auth/email-already-in-use"); assert.equal(log.set.length, sets, "no record without an account");
  assert.equal(log.second.at(-1)[0], "delete", "the second connection is always thrown away");
  await assert.rejects(be.addUser({ name: "", email: "x@x.nl" }), /name/); await assert.rejects(be.addUser({ name: "X", email: "not an address" }), /valid email/);
});
test("the password mail carries the address of the sign-in screen as continue address, and goes without it when Firebase refuses that address (H8)", async () => {
  const at = async (location) => { global.location = location; try { const { be, log } = load({ data: DATA }, null, "", false); await tick(); await be.resetPassword("ann@x.nl"); return [log.mail, log.mailWith]; } finally { delete global.location; } };
  assert.deepEqual(await at({ protocol: "https:", origin: "https://x.github.io", pathname: "/tallyroom/", search: "?set=a&mode=resetPassword" }), [["ann@x.nl"], [{ url: "https://x.github.io/tallyroom/?host=1" }]]);
  assert.deepEqual(await at({ protocol: "https:", origin: "https://blocked.example", pathname: "/" }), [["ann@x.nl", "ann@x.nl"], [{ url: "https://blocked.example/?host=1" }, null]], "sent again without it");
  assert.deepEqual(await at({ protocol: "file:", origin: "null", pathname: "/C:/index.html" }), [["ann@x.nl"], [null]]);
  assert.deepEqual(await at(undefined), [["ann@x.nl"], [null]]);
});
test("set password with the code of the link, and change password after checking the current one (H8)", async () => {
  const calls = [], me = { uid: "u_ann", isAnonymous: false, email: "ann@x.nl", reauthenticateWithCredential: async (c) => { calls.push(["reauth", c.email, c.pw]); if (c.pw !== "current") throw Object.assign(new Error("bad"), { code: "auth/wrong-password" }); }, updatePassword: async (pw) => calls.push(["update", pw]) };
  const { be, log } = load({ data: DATA, user: me }, null, "", false); await tick();
  assert.equal(await be.checkResetCode("good"), "new@x.nl"); await assert.rejects(be.checkResetCode("old"), (e) => global.TRCore.linkIsDead(e));
  await be.setPassword("good", "correct horse battery"); assert.deepEqual(log.confirmed, ["good", "correct horse battery"]); await assert.rejects(be.setPassword("used", "x"), (e) => global.TRCore.linkIsDead(e));
  await assert.rejects(be.changePassword("wrong", "correct horse battery"), (e) => e.code === "auth/wrong-password"); assert.deepEqual(calls, [["reauth", "ann@x.nl", "wrong"]], "nothing changes with a wrong current password");
  await be.changePassword("current", "correct horse battery"); assert.deepEqual(calls.slice(1), [["reauth", "ann@x.nl", "current"], ["update", "correct horse battery"]]);
  const anon = load({ data: DATA }, null, "set=a", true); await tick(); await assert.rejects(anon.be.changePassword("a", "b"), /Not signed in/);
});
test("demo mode: add user, the link that the mail would hold, set password once, change password (H8)", async () => {
  global.localStorage = fakeStorage(); global.addEventListener = () => {};
  delete require.cache[require.resolve("../js/backend.js")]; const B = require("../js/backend.js"), mk = (q) => B.make({ firebaseConfig: {}, params: new URLSearchParams(q) });
  const adm = mk("demo=1"), usr = mk("demo=1&role=user"); let users = null; adm.onUsers((u) => (users = u));
  await assert.rejects(usr.addUser({ name: "X", email: "x@demo.example" }), /Only an admin/);
  await assert.rejects(adm.addUser({ name: "Dup", email: "SAM.demo@demo.example" }), /already a user/);
  const out = await adm.addUser({ name: "Nina", email: "nina@demo.example", role: "user" }); assert.equal(out.mailed, false); assert.ok(out.code);
  assert.deepEqual({ ...users[out.uid], createdAt: 0 }, { email: "nina@demo.example", name: "Nina", role: "user", createdAt: 0 });
  assert.equal(await adm.checkResetCode(out.code), "nina@demo.example"); await adm.setPassword(out.code, "correct horse battery");
  await assert.rejects(adm.checkResetCode(out.code), (e) => global.TRCore.linkIsDead(e), "a link works once"); await assert.rejects(adm.setPassword(out.code, "x"), (e) => global.TRCore.linkIsDead(e));
  await assert.rejects(adm.checkResetCode("nonsense"), (e) => global.TRCore.linkIsDead(e));
  const again = await adm.resetPassword("Nina@demo.example"); assert.ok(again.code && again.code !== out.code); assert.deepEqual(await adm.resetPassword("nobody@demo.example"), {});
  await assert.rejects(adm.changePassword("wrong", "correct horse battery"), (e) => e.code === "auth/wrong-password");
  await adm.changePassword("demo", "correct horse battery"); await assert.rejects(adm.changePassword("demo", "another long one 1"), (e) => e.code === "auth/wrong-password"); await adm.changePassword("correct horse battery", "another long one 1");
});
test("demo mode: a set is created with its poll, and not over an existing one", async () => {
  global.localStorage = fakeStorage(); global.addEventListener = () => {};
  delete require.cache[require.resolve("../js/backend.js")]; const be = require("../js/backend.js").make({ firebaseConfig: {}, params: new URLSearchParams("demo=1") });
  assert.equal(await be.setExists("new1"), false); await be.createSet("new1", { name: "N", owner: be.id }, { config: { questions: [] }, session: {} });
  assert.equal(await be.setExists("new1"), true); assert.deepEqual(await be.readPoll("new1"), { config: { questions: [] }, session: {} });
  await assert.rejects(be.createSet("new1", { name: "Again" }, {}), /already in use/); assert.equal((await be.getSets()).new1.name, "N");
});
test("a participant listens to its own record, what is shown and the names, never to all votes; a presenter to all votes", async () => {
  const part = load({ data: DATA }, null, "set=a", true); await tick();
  const p = part.be.poll("a"), got = {}; p.onVotes((v) => (got.all = v)); p.onMine((v) => (got.mine = v)); p.onShown((v) => (got.shown = v)); p.onNames((v) => (got.names = v)); await tick();
  assert.deepEqual(part.log.on, ["sets/a", "polls/a/votes/anon1", "polls/a/shown", "polls/a/names"]); assert.deepEqual(got.all, {});
  const host = load({ data: DATA, user: { uid: "u_ann", isAnonymous: false } }, null, "set=a", true); await tick();
  const h = host.be.poll("a"); h.onVotes(() => {}); h.onMine(() => {}); h.onShown(() => {}); h.onNames(() => {}); await tick();
  assert.deepEqual(host.log.on, ["sets/a", "polls/a/votes"]);
});
/* ---------- rights per set and the list of sets (backlog H5) ---------- */
const WORLD = () => ({ users: DATA.users,
  sets: { mine: { name: "Mine", owner: "u_ann" }, shared: { name: "Shared", owner: "u_piet", shared: { u_ann: true } }, pub: { name: "Public", owner: "u_piet", visibility: "public" }, priv: { name: "Private", owner: "u_piet" }, old: { name: "Old" } },
  userSets: { u_ann: { shared: true, gone: true, priv: true } }, // gone: deleted since; priv: an entry that was left behind after the sharing ended
  polls: { mine: { votes: { x: { round: 1 } } }, shared: { votes: { x: { round: 1 } } }, pub: { votes: { x: { round: 1 } } } } });
const ann = { uid: "u_ann", isAnonymous: false, email: "ann@x.nl" };
test("a user is presenter of the sets it owns or that are shared with it, and a participant of every other set", async () => {
  for (const [id, manages] of [["mine", true], ["shared", true], ["pub", false], ["priv", false], ["old", false], ["nope", false]]) {
    const { be, log } = load({ data: WORLD(), user: ann }, null, "set=" + id, true); await tick();
    const p = be.poll(id), rights = []; let votes = null; p.onRight((r) => rights.push(r)); p.onVotes((v) => (votes = v)); p.onMine(() => {}); await tick();
    assert.deepEqual(rights, [manages], id); assert.equal(be.isHost, true, "still a user");
    assert.deepEqual(log.on, ["sets/" + id, manages ? `polls/${id}/votes` : `polls/${id}/votes/u_ann`], id);
    assert.deepEqual(votes, manages ? { x: { round: 1 } } : {}, id);
  }
  const adm = load({ data: WORLD(), user: { uid: "u_adm", isAnonymous: false } }, null, "set=priv", true); await tick();
  const rights = []; adm.be.poll("priv").onRight((r) => rights.push(r)); await tick(); assert.deepEqual(rights, [true], "an admin presents every set");
});
test("the right on an open set follows its record: shared, taken away, given to another owner", async () => {
  const { be, log, change } = load({ data: WORLD(), user: ann }, null, "set=priv", true); await tick();
  const p = be.poll("priv"), rights = [], votes = []; p.onRight((r) => rights.push(r)); p.onVotes((v) => votes.push(Object.keys(v).length)); p.onMine(() => {}); await tick();
  change("polls/priv/votes", { x: { round: 1 }, y: { round: 1 } }); await tick(); assert.deepEqual(votes, [0], "a participant does not get the answers");
  change("sets/priv/shared", { u_ann: true }); await tick(); assert.deepEqual(rights, [false, true]); assert.equal(log.on.at(-1), "polls/priv/votes"); assert.equal(votes.at(-1), 2);
  change("sets/priv/name", "Renamed"); await tick(); assert.deepEqual(rights, [false, true], "another change of the record does not touch the right");
  change("sets/priv/shared", null); await tick(); assert.deepEqual(rights, [false, true, false]); assert.equal(log.on.at(-1), "polls/priv/votes/u_ann"); assert.equal(votes.at(-1), 0);
  change("sets/priv/owner", "u_ann"); await tick(); assert.deepEqual(rights, [false, true, false, true]);
  change("sets/priv", null); await tick(); assert.equal(rights.at(-1), false, "a deleted set has no presenter");
});
test("the catch-up read of who manages a set takes the whole poll; of anyone else only the parts", async () => {
  const calls = []; global.fetch = async (url) => { calls.push(url.split(".json")[0].replace("https://x.example/", "")); return { ok: true, json: async () => ({}) }; };
  const u = { ...ann, getIdToken: async () => "t" };
  const a = load({ data: WORLD(), user: u }, null, "set=mine", true); await tick(); const pa = a.be.poll("mine"); await tick(); await pa.pull(); assert.deepEqual(calls, ["polls/mine"]);
  calls.length = 0; const b = load({ data: WORLD(), user: u }, null, "set=pub", true); await tick(); const pb = b.be.poll("pub"); await tick(); await pb.pull();
  assert.deepEqual(calls.sort(), ["polls/pub/config", "polls/pub/names", "polls/pub/session", "polls/pub/shown", "polls/pub/votes/u_ann"]);
  calls.length = 0; await b.be.readConfig("pub"); assert.deepEqual(calls, ["polls/pub/config"]);
});
test("the list of sets of a user: own, shared with it and public, from three sources; never the private sets of others", async () => {
  const { be, log, change } = load({ data: WORLD(), user: ann }, null, "", false); await tick();
  const seen = []; be.onSets((s, err) => seen.push(err ? "error" : Object.keys(s).sort())); await tick();
  assert.deepEqual(log.on, ["sets?owner=u_ann", "sets?visibility=public", "userSets/u_ann", "sets/shared", "sets/gone", "sets/priv"]);
  assert.deepEqual(seen, [["mine", "pub", "shared"]], "one answer, when every source has answered; the stale entries are skipped");
  change("sets/new1", { name: "New", owner: "u_ann" }); await tick(); assert.deepEqual(seen.at(-1), ["mine", "new1", "pub", "shared"]);
  change("sets/pub/visibility", "private"); await tick(); assert.deepEqual(seen.at(-1), ["mine", "new1", "shared"], "made private again: gone from the list");
  change("sets/shared/shared", null); await tick(); assert.deepEqual(seen.at(-1), ["mine", "new1"], "no longer shared, although the index still lists it");
  change("sets/priv/shared", { u_ann: true }); await tick(); assert.deepEqual(seen.at(-1), ["mine", "new1", "priv"]);
  change("userSets/u_ann", { shared: true }); await tick(); assert.deepEqual(seen.at(-1), ["mine", "new1"]); assert.ok(log.off.includes("sets/priv") && log.off.includes("sets/gone"));
});
test("the list of sets of an admin is the whole list; signing out stops it", async () => {
  const { be, log } = load({ data: WORLD(), user: { uid: "u_adm", isAnonymous: false } }, null, "", false); await tick();
  const seen = []; be.onSets((s) => seen.push(Object.keys(s).sort())); await tick();
  assert.deepEqual(log.on, ["sets"]); assert.deepEqual(seen, [["mine", "old", "priv", "pub", "shared"]]);
  await be.signOut(); await tick(); assert.ok(log.off.includes("sets")); assert.equal(seen.length, 1);
});
test("demo mode follows the same rights: the user sees its shared and the public set, and presents only the shared one", async () => {
  global.localStorage = fakeStorage(); global.addEventListener = () => {};
  delete require.cache[require.resolve("../js/backend.js")]; const B = require("../js/backend.js"), mk = (q) => B.make({ firebaseConfig: {}, params: new URLSearchParams(q) });
  const adm = mk("demo=1"), usr = mk("demo=1&role=user"), part = mk("demo=1&host=off"), list = (b) => { let s = null; b.onSets((x) => (s = Object.keys(x))); return s; };
  assert.deepEqual(list(adm), ["demo0001", "demo0002", "demo0003"]); assert.deepEqual(list(usr), ["demo0002", "demo0003"]); assert.deepEqual(list(part), []);
  const right = (b, id) => { let r = null; b.poll(id).onRight((x) => (r = x)); return r; };
  assert.deepEqual(["demo0001", "demo0002", "demo0003"].map((id) => [right(adm, id), right(usr, id), right(part, id)]), [[true, false, false], [true, false, false], [true, true, false]]);
  await usr.createSet("mine01", { name: "Mine", owner: usr.id }, { config: { questions: [] }, session: {} }); assert.deepEqual(list(usr), ["demo0002", "demo0003", "mine01"]); assert.equal(right(usr, "mine01"), true);
  const rights = []; usr.poll("demo0002").onRight((r) => rights.push(r)); await usr.patchMeta("demo0002", { shared: { "demo-user": true } }); // in a browser the other tab does this, and the change arrives through the shared store
  assert.deepEqual(rights.filter((r, i) => i === 0 || r !== rights[i - 1]), [false, true], "shared while open: presenter at once");
  assert.deepEqual(await usr.readConfig("demo0002").then((c) => c.questions.length), 2);
});
test("a participant's catch-up read asks only for the parts it may read", async () => {
  const calls = []; global.fetch = async (url) => { calls.push(url.split(".json")[0].replace("https://x.example/", "")); return { ok: true, json: async () => ({}) }; };
  const { be } = load({ data: DATA, user: { uid: "anonX", isAnonymous: true, getIdToken: async () => "t" } }, null, "set=a", true); await tick();
  const d = await be.poll("a").pull();
  assert.deepEqual(calls.sort(), ["polls/a/config", "polls/a/names", "polls/a/session", "polls/a/shown", "polls/a/votes/anonX"]); assert.equal(d.mine, null);
});
