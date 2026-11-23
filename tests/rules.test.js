/* Run with:  node --test
   Tries database.rules.json against the rights of backlog H4, with a small stand-in for the way Firebase evaluates rules:
     read      allowed when a .read rule on the path, from the root down, says yes
     write     allowed when a .write rule on the path says yes, and every .validate rule on the path and below it
               accepts the new data; an update of several paths is all or nothing, and each rule sees the data as it
               will be after the whole update (newData)
   It is not Firebase. After publishing the rules, the cases in tests/rules-checklist.md are tried on the real database. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");

const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, "../database.rules.json"), "utf8")).rules;
if (!String.prototype.matches) Object.defineProperty(String.prototype, "matches", { value(re) { return re.test(this); } });

const at = (v, keys) => keys.reduce((o, k) => (o != null && typeof o === "object" && o[k] !== undefined ? o[k] : null), v);
function snap(rootVal, keys) { const v = at(rootVal, keys);
  return { val: () => v, exists: () => v != null, child: (p) => snap(rootVal, keys.concat(String(p).split("/"))), parent: () => snap(rootVal, keys.slice(0, -1)),
    hasChild: (k) => at(v, [k]) != null, hasChildren: (ks) => (ks ? ks.every((k) => at(v, [k]) != null) : v != null && typeof v === "object" && Object.keys(v).length > 0),
    isString: () => typeof v === "string", isNumber: () => typeof v === "number", isBoolean: () => typeof v === "boolean" }; }
function evalRule(expr, ctx) { if (typeof expr === "boolean") return expr;
  const names = Object.keys(ctx); try { return new Function(...names, `"use strict"; return (${expr});`)(...names.map((n) => ctx[n])) === true; } catch (e) { return false; } }
/* the rule nodes along a path: [{node, keys, vars}], from the root down, as far as the rules go */
function walk(keys) { const out = [{ node: RULES, keys: [], vars: {} }]; let node = RULES, vars = {};
  for (let i = 0; i < keys.length && node; i++) { const k = keys[i], wild = Object.keys(node).find((n) => n[0] === "$");
    if (node[k] !== undefined && k[0] !== "." && k[0] !== "$") node = node[k]; else if (wild) { vars = { ...vars, [wild]: k }; node = node[wild]; } else node = null;
    if (node && typeof node === "object") out.push({ node, keys: keys.slice(0, i + 1), vars }); }
  return out; }
const split = (p) => p.split("/").filter(Boolean);
function canRead(db, auth, p, query) { const keys = split(p);
  return walk(keys).some(({ node, keys: ks, vars }) => node[".read"] !== undefined &&
    evalRule(node[".read"], { auth, root: snap(db, []), data: snap(db, ks), now: NOW, query: query || {}, ...vars })); }
function applied(db, updates) { const out = JSON.parse(JSON.stringify(db));
  for (const [p, v] of Object.entries(updates)) { const keys = split(p), last = keys.pop(); let o = out;
    for (const k of keys) { if (o[k] == null || typeof o[k] !== "object") o[k] = {}; o = o[k]; }
    if (v == null) delete o[last]; else o[last] = JSON.parse(JSON.stringify(v)); }
  return out; }
function validBelow(node, keys, vars, db, next, auth) { const nd = snap(next, keys); if (!nd.exists()) return true;
  const ctx = { auth, root: snap(db, []), data: snap(db, keys), newData: nd, now: NOW, ...vars };
  if (node[".validate"] !== undefined && !evalRule(node[".validate"], ctx)) return false;
  const v = nd.val(); if (v == null || typeof v !== "object") return true;
  return Object.keys(v).every((k) => { const wild = Object.keys(node).find((n) => n[0] === "$");
    if (node[k] !== undefined && k[0] !== "." && k[0] !== "$") return validBelow(node[k], keys.concat(k), vars, db, next, auth);
    return wild ? validBelow(node[wild], keys.concat(k), { ...vars, [wild]: k }, db, next, auth) : true; }); }
/* updates = {path: value|null}; one path is a plain set or remove */
function canWrite(db, auth, updates) { const next = applied(db, updates);
  return Object.keys(updates).every((p) => { const keys = split(p), steps = walk(keys), ctxAt = (s) => ({ auth, root: snap(db, []), data: snap(db, s.keys), newData: snap(next, s.keys), now: NOW, ...s.vars });
    if (!steps.some((s) => s.node[".write"] !== undefined && evalRule(s.node[".write"], ctxAt(s)))) return false;
    if (!steps.slice(0, -1).every((s) => s.node[".validate"] === undefined || !snap(next, s.keys).exists() || evalRule(s.node[".validate"], ctxAt(s)))) return false;
    const last = steps.at(-1); return last.keys.length === keys.length ? validBelow(last.node, keys, last.vars, db, next, auth) : true; }); }

/* ---------- the people and the data ---------- */
const NOW = Date.now();
const ADM = { uid: "adm" }, ANN = { uid: "ann" }, PIET = { uid: "piet" }, SAM = { uid: "sam" }, STRAY = { uid: "stray" }, PHONE = { uid: "phone1" }, NOBODY = null;
const user = (name, role) => ({ email: name + "@x.nl", name, role, createdAt: 1 });
const poll = () => ({ config: { mode: "live", qids: { q1: true } }, session: { phase: "voting", round: 1 }, votes: { phone1: { round: 1, t: NOW, answers: { q1: 2 } } }, actions: { k: { action: "x" } }, shown: { q1_0: { answers: { q1: 2 } } }, names: {} });
const DB = () => ({
  users: { adm: user("adm", "admin"), ann: user("ann", "user"), piet: user("piet", "user"), sam: user("sam", "user") },
  sets: {
    priv: { name: "Private", owner: "ann", visibility: "private", shared: { piet: true }, expiresAt: NOW + 1e6 },
    pub: { name: "Public", owner: "ann", visibility: "public", expiresAt: NOW + 1e6 },
    old: { name: "From before owners", expiresAt: NOW + 1e6 },
    gone: { name: "Expired", owner: "ann", expiresAt: NOW - 1 } },
  userSets: { piet: { priv: true } },
  polls: { priv: poll(), pub: poll(), old: poll(), gone: poll() } });
const EVERYONE = { NOBODY, PHONE, STRAY, ANN, PIET, SAM, ADM };
const who = (fn) => Object.fromEntries(Object.entries(EVERYONE).map(([n, a]) => [n, fn(a)]));
const only = (...names) => Object.fromEntries(Object.keys(EVERYONE).map((n) => [n, names.includes(n)]));
const vote = (extra) => ({ round: 1, t: NOW, answers: { q1: 3 }, ...(extra || {}) });

test("the stand-in reads every rule: each expression is valid", () => {
  const bad = []; (function scan(node, p) { for (const [k, v] of Object.entries(node)) { if (k === ".indexOn") continue;
    if (k[0] === ".") { if (typeof v !== "boolean") try { new Function("auth", "root", "data", "newData", "now", "query", "$set", "$uid", "$q", "$field", "$other", `return (${v});`); } catch (e) { bad.push(p + "/" + k); } }
    else scan(v, p + "/" + k); } })(RULES, "");
  assert.deepEqual(bad, []);
});

/* ---------- users ---------- */
test("users: every user reads the list, an account reads its own record, only an admin writes", () => {
  assert.deepEqual(who((a) => canRead(DB(), a, "users")), only("ANN", "PIET", "SAM", "ADM"));
  assert.equal(canRead(DB(), STRAY, "users/stray"), true, "so the page can follow a record that is added later");
  assert.equal(canRead(DB(), STRAY, "users/ann"), false); assert.equal(canRead(DB(), PHONE, "users/ann"), false);
  assert.deepEqual(who((a) => canWrite(DB(), a, { "users/new1": user("new", "user") })), only("ADM"));
  assert.deepEqual(who((a) => canWrite(DB(), a, { "users/ann/role": "admin" })), only("ADM"), "nobody makes themself admin");
  assert.equal(canWrite(DB(), STRAY, { "users/stray": user("stray", "admin") }), false);
  assert.equal(canWrite(DB(), ADM, { "users/ann": null }), true);
});
test("users: a record needs a role that exists and holds no other fields", () => {
  for (const bad of [{ email: "x@x.nl" }, { role: "presenter" }, { role: "user", extra: 1 }, { role: "user", name: "n".repeat(61) }, { role: "user", email: 5 }])
    assert.equal(canWrite(DB(), ADM, { "users/new1": bad }), false, JSON.stringify(bad));
  assert.equal(canWrite(DB(), ADM, { "users/new1": { role: "user" } }), true);
});

test("users: an admin cannot remove or demote themself, so one admin is always left; another admin can (H7)", () => {
  assert.equal(canWrite(DB(), ADM, { "users/adm": null }), false); assert.equal(canWrite(DB(), ADM, { "users/adm/role": "user" }), false);
  assert.equal(canWrite(DB(), ADM, { "users/adm": user("adm", "user") }), false);
  assert.equal(canWrite(DB(), ADM, { "users/adm/name": "Admin" }), true, "the own name"); assert.equal(canWrite(DB(), ADM, { "users/adm": user("Admin", "admin") }), true);
  const two = DB(); two.users.ann.role = "admin";
  assert.equal(canWrite(two, ANN, { "users/adm/role": "user" }), true); assert.equal(canWrite(two, ANN, { "users/adm": null }), true);
  assert.deepEqual(who((a) => canWrite(DB(), a, { "users/piet/name": "Piet de Vries" })), only("ADM"), "nobody else changes a name, also not their own");
});
test("users: removing access is one write by an admin: the record, and the user off every shared list (H7)", () => {
  const up = { "users/piet": null, "sets/priv/shared/piet": null, "userSets/piet/priv": null };
  assert.deepEqual(who((a) => canWrite(DB(), a, up)), only("ADM"));
  assert.equal(canWrite(DB(), ADM, { "users/piet": null, "userSets/piet": null }), false, "the index is removed entry by entry, as the page does");
});
test("former users: the accounts whose access was removed are remembered for admins only, to give them access again (H8)", () => {
  const note = { email: "piet@x.nl", name: "piet", removedAt: NOW }, db = () => ({ ...DB(), formerUsers: { gone1: note } });
  assert.deepEqual(who((a) => canWrite(DB(), a, { "users/piet": null, "sets/priv/shared/piet": null, "userSets/piet/priv": null, "formerUsers/piet": note })), only("ADM"), "removing access, with the note");
  assert.deepEqual(who((a) => canRead(db(), a, "formerUsers")), only("ADM")); assert.deepEqual(who((a) => canRead(db(), a, "formerUsers/gone1")), only("ADM"));
  assert.deepEqual(who((a) => canWrite(db(), a, { "users/gone1": user("piet", "user"), "formerUsers/gone1": null })), only("ADM"), "giving access back");
  for (const bad of [{ name: "x" }, { email: 5 }, { email: "a@x.nl", extra: 1 }, { email: "a@x.nl", removedAt: "now" }, { email: "a@x.nl", name: "n".repeat(61) }]) assert.equal(canWrite(DB(), ADM, { "formerUsers/x1": bad }), false, JSON.stringify(bad));
  assert.equal(canWrite(DB(), PIET, { "formerUsers/piet": null }), false);
});
/* ---------- the list of sets ---------- */
test("list of sets: an admin reads it whole; a user only through the two queries; nobody else", () => {
  assert.deepEqual(who((a) => canRead(DB(), a, "sets")), only("ADM"));
  assert.deepEqual(who((a) => canRead(DB(), a, "sets", a && { orderByChild: "owner", equalTo: a.uid })), only("ANN", "PIET", "SAM", "ADM"));
  assert.deepEqual(who((a) => canRead(DB(), a, "sets", { orderByChild: "visibility", equalTo: "public" })), only("ANN", "PIET", "SAM", "ADM"));
  assert.equal(canRead(DB(), SAM, "sets", { orderByChild: "owner", equalTo: "ann" }), false, "not somebody else's sets");
  assert.equal(canRead(DB(), SAM, "sets", { orderByChild: "visibility", equalTo: "private" }), false);
  assert.equal(canRead(DB(), SAM, "sets", { orderByChild: "name", equalTo: "Private" }), false);
  assert.deepEqual(RULES.sets[".indexOn"], ["owner", "visibility"]);
});
test("one set record: every signed-in device reads it, as a participant needs", () => {
  assert.deepEqual(who((a) => canRead(DB(), a, "sets/priv")), only("PHONE", "STRAY", "ANN", "PIET", "SAM", "ADM"));
});
test("the index of sets shared with a user: read by that user and admins; written by who controls the set, removed by the user", () => {
  assert.deepEqual(who((a) => canRead(DB(), a, "userSets/piet")), only("PIET", "ADM"));
  assert.deepEqual(who((a) => canWrite(DB(), a, { "userSets/sam/priv": true })), only("ANN", "ADM"));
  assert.deepEqual(who((a) => canWrite(DB(), a, { "userSets/piet/priv": null })), only("ANN", "PIET", "ADM"));
  assert.equal(canWrite(DB(), ANN, { "userSets/sam/priv": "yes" }), false);
  assert.equal(canWrite(DB(), SAM, { "userSets/sam/priv": true }), false, "a user cannot list a set for themself");
});

/* ---------- creating, changing, deleting a set ---------- */
const newSet = (owner, extra) => ({ name: "New", owner, visibility: "private", expiresAt: NOW + 1e6, ...(extra || {}) });
test("create: a user makes a set with its poll in one write, as its own; not for someone else, not without owner", () => {
  const mk = (a, owner) => canWrite(DB(), a, { "sets/new1": newSet(owner), "polls/new1": { config: { mode: "live" }, session: { phase: "lobby" } } });
  assert.deepEqual(who((a) => mk(a, a && a.uid)), only("ANN", "PIET", "SAM", "ADM"));
  assert.equal(mk(SAM, "ann"), false); assert.equal(mk(SAM, undefined), false);
  assert.equal(mk(ADM, "ann"), true, "an admin may create a set for a user");
  assert.equal(mk(ADM, "stray"), false, "not for an account that is no user");
  assert.equal(canWrite(DB(), SAM, { "polls/new1": { config: { mode: "live" } } }), false, "no poll without its set");
  assert.equal(canWrite(DB(), SAM, { "sets/priv": newSet("sam") }), false, "an existing set cannot be taken over by writing it again");
  assert.equal(canWrite(DB(), SAM, { "sets/new1": newSet("sam", { visibility: "open" }) }), false);
});
test("settings of a set: owner, shared user and admin change them; a viewer, another user and a participant do not", () => {
  for (const id of ["priv", "pub"]) assert.deepEqual(who((a) => canWrite(DB(), a, { [`sets/${id}/name`]: "Renamed", [`sets/${id}/updatedAt`]: NOW })), only("ANN", ...(id === "priv" ? ["PIET"] : []), "ADM"), id);
  assert.deepEqual(who((a) => canWrite(DB(), a, { "sets/old/name": "x" })), only("ADM"), "a set without owner is for admins");
});
test("control: only owner and admin delete, switch private / public and change who it is shared with", () => {
  assert.deepEqual(who((a) => canWrite(DB(), a, { "sets/priv": null, "polls/priv": null, "userSets/piet/priv": null })), only("ANN", "ADM"), "delete");
  assert.deepEqual(who((a) => canWrite(DB(), a, { "sets/priv/visibility": "public" })), only("ANN", "ADM"));
  assert.deepEqual(who((a) => canWrite(DB(), a, { "sets/priv/shared/sam": true, "userSets/sam/priv": true })), only("ANN", "ADM"), "share");
  assert.deepEqual(who((a) => canWrite(DB(), a, { "sets/priv/shared/piet": null, "userSets/piet/priv": null })), only("ANN", "PIET", "ADM"), "unshare, or leave");
  assert.equal(canWrite(DB(), PIET, { "sets/priv/shared/sam": null }), false, "a shared user removes only themself");
  assert.equal(canWrite(DB(), ANN, { "sets/priv/visibility": "secret" }), false);
  assert.equal(canWrite(DB(), ANN, { "sets/priv/shared/stray": true }), false, "sharing only with users");
  assert.equal(canWrite(DB(), ANN, { "sets/priv/shared/ann": true }), false, "the owner is not on the shared list");
  assert.equal(canWrite(DB(), ANN, { "sets/priv/shared/sam": "yes" }), false);
});
test("assign: only an admin gives a set another owner, and only to a user", () => {
  assert.deepEqual(who((a) => canWrite(DB(), a, { "sets/priv/owner": "sam" })), only("ADM"));
  assert.equal(canWrite(DB(), ANN, { "sets/priv": { ...DB().sets.priv, owner: "sam" } }), false, "nor by writing the whole record");
  assert.equal(canWrite(DB(), PIET, { "sets/priv/owner": "piet" }), false);
  assert.equal(canWrite(DB(), ADM, { "sets/priv/owner": "stray" }), false);
  assert.deepEqual(who((a) => canWrite(DB(), a, { "sets/priv/owner": "piet", "sets/priv/shared/piet": null, "userSets/piet/priv": null })), only("ADM"), "to someone on the shared list, who leaves it (H7)");
  assert.equal(canWrite(DB(), ADM, { "sets/old/owner": "adm" }), true, "taking over a set from before owners (H3)");
  assert.equal(canWrite(DB(), ANN, { "sets/old/owner": "ann" }), false);
});
test("change link: the owner moves set, poll and share index in one write; a shared user cannot", () => {
  const d = DB(), move = (a) => canWrite(DB(), a, { "sets/moved": d.sets.priv, "polls/moved": d.polls.priv, "userSets/piet/moved": true, "sets/priv": null, "polls/priv": null, "userSets/piet/priv": null });
  assert.deepEqual(who(move), only("ANN", "ADM"));
  assert.equal(canWrite(DB(), ANN, { "sets/pub": d.sets.priv, "polls/pub": d.polls.priv, "sets/priv": null, "polls/priv": null }), true, "onto an own set: the page checks that the link is free");
  assert.equal(canWrite(DB(), SAM, { "sets/moved": { ...d.sets.priv, owner: "sam" }, "polls/moved": d.polls.priv, "sets/priv": null, "polls/priv": null }), false);
});

/* ---------- questions, answers, actions ---------- */
test("a poll as a whole (answers, actions): read and written by who manages the set", () => {
  assert.deepEqual(who((a) => canRead(DB(), a, "polls/priv")), only("ANN", "PIET", "ADM"));
  assert.deepEqual(who((a) => canRead(DB(), a, "polls/pub")), only("ANN", "ADM"), "public shows the questions, not the answers");
  for (const p of ["votes", "actions", "votes/phone1"]) assert.deepEqual(who((a) => canRead(DB(), a, "polls/pub/" + p)), only(...(p === "votes/phone1" ? ["PHONE"] : []), "ANN", "ADM"), p);
  assert.deepEqual(who((a) => canRead(DB(), a, "polls/old")), only("ADM"));
  for (const p of ["config", "session", "actions/k", "shown", "votes"]) assert.deepEqual(who((a) => canWrite(DB(), a, { ["polls/priv/" + p]: p === "votes" ? null : { mode: "batch" } })), only("ANN", "PIET", "ADM"), p);
  assert.deepEqual(who((a) => canWrite(DB(), a, { "polls/pub/config": { mode: "batch" } })), only("ANN", "ADM"));
});
test("what a participant reads: questions, session, what is shown, names and its own record, with the link of any set", () => {
  for (const p of ["config", "session", "shown", "names"]) assert.deepEqual(who((a) => canRead(DB(), a, "polls/priv/" + p)), only("PHONE", "STRAY", "ANN", "PIET", "SAM", "ADM"), p);
  assert.equal(canRead(DB(), PHONE, "polls/priv/votes/phone1"), true); assert.equal(canRead(DB(), { uid: "phone2" }, "polls/priv/votes/phone1"), false);
  assert.equal(canRead(DB(), SAM, "polls/pub/votes/phone1"), false);
});
test("what a participant writes: its own answers and name, in a set that exists and has not expired (as before this epic)", () => {
  const P2 = { uid: "phone2" };
  assert.equal(canWrite(DB(), P2, { "polls/priv/votes/phone2": vote() }), true);
  assert.equal(canWrite(DB(), SAM, { "polls/priv/votes/sam": vote() }), true, "a user who opens someone else's link takes part");
  assert.equal(canWrite(DB(), P2, { "polls/priv/votes/phone1": vote() }), false, "not another device's record");
  assert.equal(canWrite(DB(), P2, { "polls/gone/votes/phone2": vote() }), false, "expired");
  assert.equal(canWrite(DB(), P2, { "polls/nope/votes/phone2": vote() }), false, "no such set");
  assert.equal(canWrite(DB(), NOBODY, { "polls/priv/votes/x": vote() }), false);
  assert.equal(canWrite(DB(), P2, { "polls/priv/votes/phone2": vote({ answers: { other: 1 } }) }), false, "not a question of the set");
  assert.equal(canWrite(DB(), P2, { "polls/priv/votes/phone2": vote({ answers: { q1: 12 } }) }), false);
  assert.equal(canWrite(DB(), P2, { "polls/priv/votes/phone2": vote({ extra: 1 }) }), false);
  assert.equal(canWrite(DB(), P2, { "polls/priv/votes/phone2": vote({ texts: { q1: "x".repeat(2001) } }) }), false);
  assert.equal(canWrite(DB(), P2, { "polls/priv/names/phone2": { n: "Jan", at: NOW } }), true);
  assert.equal(canWrite(DB(), P2, { "polls/priv/names/phone1": { n: "Jan", at: NOW } }), false);
  for (const p of ["config", "session", "shown", "actions/k"]) assert.equal(canWrite(DB(), P2, { ["polls/priv/" + p]: { x: 1 } }), false, p);
  assert.equal(canWrite(DB(), ANN, { "polls/gone/votes/phone2": vote() }), true, "who manages the set also writes in an expired one");
});
test("nothing outside users, formerUsers, sets, userSets and polls can be read or written, also not by an admin; presenters is gone", () => {
  assert.equal(RULES.presenters, undefined);
  for (const p of ["presenters/adm", "other", ""]) { assert.equal(canRead(DB(), ADM, p), false, p); if (p) assert.equal(canWrite(DB(), ADM, { [p]: true }), false, p); }
});
