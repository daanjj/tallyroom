/* Run with:  node --test
   Covers js/core.js, the pure logic of Tally Room. No browser, no database. */
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/core.js");

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const tl = (text) => ({ ...C.q(text, 1, 3, "", "", null, true) });
const vote = (round, answers, texts, t) => ({ round, answers, texts: texts || {}, t: t || NOW });

/* ---------- question sets (A1, A3) ---------- */
test("set id: the name as a slug, valid as ?set= value", () => {
  assert.equal(C.setIdFor("MT offsite, team B!"), "mt-offsite-team-b");
  assert.equal(C.setIdFor("  "), "set");
  for (const n of ["Café Zürich", "x".repeat(60), "!!!", "Top 10 besluiten"]) assert.ok(C.SET_ID_RE.test(C.setIdFor(n)), n);
});
test("set id: a taken slug gets -2, -3 and stays within 40 characters", () => {
  const taken = (...ids) => (id) => ids.includes(id);
  assert.equal(C.setIdFor("Team B", taken("team-b")), "team-b-2");
  assert.equal(C.setIdFor("Team B", taken("team-b", "team-b-2")), "team-b-3");
  assert.equal(C.setIdFor("Team B", taken("other")), "team-b");
  const long = "x".repeat(40), id = C.setIdFor(long, taken(long));
  assert.equal(id, "x".repeat(38) + "-2"); assert.ok(C.SET_ID_RE.test(id));
  assert.equal(C.setIdFor("a".repeat(37) + " b c", taken("a".repeat(37) + "-b")), "a".repeat(37) + "-2");
});
test("set id pattern refuses characters that break a database path", () => {
  for (const bad of ["a/b", "a.b", "a b", "", "a#b", "x".repeat(41)]) assert.equal(C.SET_ID_RE.test(bad), false, bad);
  assert.ok(C.SET_ID_RE.test("workshop-4"));
});
test("new set: defaults are purple, generic, anonymous, 3 days", () => {
  const m = C.newMeta({ name: " Team B " }, NOW);
  assert.deepEqual(m, { name: "Team B", header: "Team B", accent: "#5A3BD6", category: "generic", named: "no",
    owner: null, visibility: "private", shared: {},
    expiresAt: NOW + 3 * C.DAY, joinUrl: "", createdAt: NOW, updatedAt: NOW });
});

/* ---------- owners, visibility and sharing (H1) ---------- */
const ANNA = { uid: "uidAnna", role: "user" }, PIET = { uid: "uidPiet", role: "user" }, SAM = { uid: "uidSam", role: "user" }, ADMIN = { uid: "uidAdmin", role: "admin" };
const owned = extra => C.newMeta({ name: "Board", owner: ANNA.uid, ...(extra || {}) }, NOW);
test("set record: a set from before owners is private, without owner and shared with nobody", () => {
  const m = C.normMeta({ name: "Old" });
  assert.equal(m.owner, null); assert.equal(m.visibility, "private"); assert.deepEqual(m.shared, {});
});
test("set record: visibility is public only when it says so; the shared list holds real uids, not the owner", () => {
  for (const v of ["Public", "yes", true, 1, "", null, undefined]) assert.equal(C.normMeta({ name: "S", visibility: v }).visibility, "private", String(v));
  assert.equal(C.normMeta({ name: "S", visibility: "public" }).visibility, "public");
  const m = C.normMeta({ name: "S", owner: "uidAnna", shared: { uidPiet: true, uidAnna: true, uidSam: false, "a/b": true, "a.b": true, uidX: "yes" } });
  assert.deepEqual(m.shared, { uidPiet: true });
  assert.deepEqual(C.normMeta({ name: "S", shared: ["uidPiet"] }).shared, {}, "a list is not a shared map");
  assert.equal(C.normMeta({ name: "S", owner: "a/b" }).owner, null); assert.equal(C.normMeta({ name: "S", owner: 12 }).owner, null);
});
test("rights: the table of who may do what on a private and a public set", () => {
  const priv = C.withShare(owned(), PIET.uid, true), pub = { ...priv, visibility: "public" };
  const row = (meta, u) => [C.setRight(meta, u), C.canManage(meta, u), C.canControl(meta, u), C.canAssign(meta, u), C.canView(meta, u)];
  for (const meta of [priv, pub]) {
    assert.deepEqual(row(meta, ANNA), ["owner", true, true, false, true]);
    assert.deepEqual(row(meta, PIET), ["shared", true, false, false, true]);
    assert.deepEqual(row(meta, ADMIN), ["admin", true, true, true, true]);
  }
  assert.deepEqual(row(priv, SAM), [null, false, false, false, false]);
  assert.deepEqual(row(pub, SAM), ["viewer", false, false, false, true]);
});
test("rights: an account without a role, a participant and nobody have no right, also on a public or shared set", () => {
  const pub = C.withShare(owned({ visibility: "public" }), PIET.uid, true);
  for (const u of [null, undefined, {}, { uid: "uidSam" }, { uid: "uidSam", role: "presenter" }, { role: "admin" }, { uid: ANNA.uid }, { uid: PIET.uid, role: null }]) {
    assert.equal(C.setRight(pub, u), null); assert.equal(C.canManage(pub, u), false); assert.equal(C.canControl(pub, u), false);
    assert.equal(C.canAssign(pub, u), false); assert.equal(C.canView(pub, u), false);
  }
  assert.equal(C.setRight(null, ADMIN), null); assert.equal(C.canAssign(null, ADMIN), false);
});
test("rights: a set without owner is for admins only; an admin who owns a set is its owner", () => {
  const old = C.newMeta({ name: "Old" }, NOW);
  assert.equal(C.setRight(old, ADMIN), "admin"); assert.equal(C.setRight(old, ANNA), null);
  assert.equal(C.setRight(C.newMeta({ name: "Mine", owner: ADMIN.uid }, NOW), ADMIN), "owner");
});
test("sharing: adding and removing leaves the original alone, and the owner is never on the list", () => {
  const m = owned(), a = C.withShare(m, PIET.uid, true), b = C.withShare(a, SAM.uid, true);
  assert.deepEqual(C.sharedWith(m), []); assert.equal(C.isShared(m), false);
  assert.deepEqual(C.sharedWith(b), ["uidPiet", "uidSam"]); assert.equal(C.isShared(b), true);
  assert.deepEqual(C.sharedWith(C.withShare(b, PIET.uid, false)), ["uidSam"]);
  assert.deepEqual(C.sharedWith(b), ["uidPiet", "uidSam"], "the record that was passed in is unchanged");
  assert.deepEqual(C.sharedWith(C.withShare(m, ANNA.uid, true)), [], "the owner");
  assert.deepEqual(C.sharedWith(C.withShare(m, "a/b", true)), [], "not a uid");
  assert.deepEqual(C.sharedWith(C.withShare(m, SAM.uid, false)), [], "removing who is not on it");
  assert.equal(C.withShare(null, PIET.uid, true), null);
});
test("assign: the new owner leaves the shared list, the previous owner keeps no rights", () => {
  const m = C.withShare(C.withShare(owned(), PIET.uid, true), SAM.uid, true), n = C.withOwner(m, PIET.uid);
  assert.equal(n.owner, PIET.uid); assert.deepEqual(C.sharedWith(n), ["uidSam"]);
  assert.equal(C.setRight(n, PIET), "owner"); assert.equal(C.setRight(n, ANNA), null); assert.equal(C.setRight(n, SAM), "shared");
  assert.equal(m.owner, ANNA.uid, "the record that was passed in is unchanged");
  assert.equal(C.withOwner(m, "a/b").owner, ANNA.uid, "not a uid: nothing changes");
});
test("duplicate: the copy of a public, shared set is private, shared with nobody and owned by who made it", () => {
  const src = C.withShare(owned({ visibility: "public" }), PIET.uid, true);
  const d = C.duplicateSet(src, { questions: [C.q("A", 1, 5, "", "")] }, NOW, SAM.uid);
  assert.equal(d.meta.owner, SAM.uid); assert.equal(d.meta.visibility, "private"); assert.deepEqual(d.meta.shared, {});
  assert.equal(C.setRight(d.meta, ANNA), null); assert.equal(C.setRight(d.meta, PIET), null);
  assert.equal(C.duplicateSet(src, {}, NOW).meta.owner, null, "no owner given: none taken over from the original");
  assert.equal(src.visibility, "public"); assert.deepEqual(C.sharedWith(src), ["uidPiet"]);
});
test("questions file: it carries no owner, visibility or sharing", () => {
  const set = C.questionsExport(C.withShare(owned({ visibility: "public" }), PIET.uid, true), { questions: [] }).set;
  assert.deepEqual(Object.keys(set).sort(), ["accent", "category", "header", "name", "named"]);
});

test("sets from before owners: found for the first admin, and the old poll is migrated with an owner", () => {
  const sets = { b: { name: "B" }, a: { name: "A", owner: "" }, mine: { name: "M", owner: "uidAnna" }, bad: { name: "X", owner: "a/b" }, junk: null };
  assert.deepEqual(C.ownerlessIds(sets), ["a", "b", "bad"]);
  assert.deepEqual(C.ownerlessIds({ mine: sets.mine }), []); assert.deepEqual(C.ownerlessIds(null), []);
  assert.equal(C.migrationMeta("workshop-4", { title: "T" }, NOW, "uidAdmin").owner, "uidAdmin");
  assert.equal(C.migrationMeta("workshop-4", { title: "T" }, NOW).owner, null);
});
test("user record: a valid role makes a user; the name falls back on the email address", () => {
  assert.deepEqual(C.normUser({ email: " anna@example.com ", name: " Anna ", role: "admin", createdAt: NOW }), { email: "anna@example.com", name: "Anna", role: "admin", createdAt: NOW });
  assert.deepEqual(C.normUser({ email: "piet@example.com", role: "user" }), { email: "piet@example.com", name: "piet", role: "user", createdAt: 0 });
  assert.equal(C.normUser({ role: "user" }).name, "Unnamed");
  for (const bad of [null, undefined, true, "admin", {}, { email: "x@example.com" }, { role: "presenter" }, { role: "Admin" }, { role: true }]) assert.equal(C.normUser(bad), null, JSON.stringify(bad));
  assert.equal(C.normUser({ role: "user", name: "n".repeat(200) }).name.length, 60);
  assert.deepEqual([C.roleName("admin"), C.roleName("user"), C.roleName("x"), C.roleName(null)], ["Admin", "User", "", ""]);
});

/* ---------- password rule (H1) ---------- */
test("password: a long password with a letter and a non-letter is fine", () => {
  for (const ok of ["correct horse battery", "Tr0ubadour-en-drie", "zomer in 2026 was nat", "ünïcödé-wachtwoorden1", "abcdefgh".repeat(15) + "1234567!"]) assert.deepEqual(C.passwordProblems(ok, "anna@example.com"), [], ok);
});
test("password: each rule gives its own reason", () => {
  const has = (pw, re, email) => assert.ok(C.passwordProblems(pw, email).some(m => re.test(m)), `${pw}: ${C.passwordProblems(pw, email).join(" | ")}`);
  has("short1!", /at least 12/); has("elevenchar1", /at least 12/);
  has("a1" + "b".repeat(127), /at most 128/);
  has("onlylettershere", /not a letter/);
  has("123456789012345", /one letter/);
  has("aaaaaaaaaaaa", /different characters/); has("abababababab1", /different characters/);
  has("anna.devries-2026", /email address/, "Anna.deVries@example.com");
  has("xx anna@example.com xx", /email address/, "anna@example.com");
  has("Password2026!", /easy to guess/); has("Welkom123456", /easy to guess/); has("123456789012", /easy to guess/);
  assert.equal(C.passwordProblems("", "anna@example.com").length, 3, "empty: too short, no letter, no non-letter");
  assert.ok(C.passwordProblems(undefined).length >= 1); assert.ok(C.passwordProblems(12345678901234).length >= 1, "not a string");
});
test("password: a short name in the email address does not block ordinary words", () => {
  assert.deepEqual(C.passwordProblems("banana bread 44", "an@example.com"), []);
  assert.deepEqual(C.passwordProblems("correct horse battery", ""), []);
});
test("meta is always complete and never holds undefined", () => {
  const m = C.normMeta({ name: "", accent: "nonsense", category: "x", named: "maybe", header: "h".repeat(200) });
  assert.equal(m.name, "Untitled"); assert.equal(m.accent, C.DEFAULT_ACCENT); assert.equal(m.category, "generic"); assert.equal(m.named, "no");
  assert.equal(m.header.length, 80); assert.equal(m.expiresAt, null);
  assert.ok(Object.values(m).every(v => v !== undefined));
  assert.equal(C.normMeta(null), null);
});
test("migration: the old poll becomes a consent set with its old title as header", () => {
  const m = C.migrationMeta("workshop-4", { title: "Domein Cloud Mission Critical poll" }, NOW);
  assert.equal(m.name, "workshop-4"); assert.equal(m.header, "Domein Cloud Mission Critical poll");
  assert.equal(m.category, "consent"); assert.equal(m.named, "no"); assert.equal(m.accent, C.DEFAULT_ACCENT); assert.equal(m.expiresAt, NOW + 3 * C.DAY);
});

/* ---------- expiry (A7) ---------- */
test("expiry: a set is expired only after its moment has passed", () => {
  const m = { expiresAt: NOW };
  assert.equal(C.isExpired(m, NOW - 1), false);
  assert.equal(C.isExpired(m, NOW), false);
  assert.equal(C.isExpired(m, NOW + 1), true);
  assert.equal(C.isExpired({ expiresAt: null }, NOW), false, "no expiry date = never expires");
  assert.equal(C.isExpired(null, NOW), false);
});
test("expiry label: ok, soon (within 24 hours, hours rounded up), expired", () => {
  assert.equal(C.expiryInfo({ expiresAt: NOW + 3 * C.DAY }, NOW).state, "ok");
  assert.deepEqual(C.expiryInfo({ expiresAt: NOW + 90 * 60000 }, NOW), { state: "soon", at: NOW + 90 * 60000, hours: 2 });
  assert.equal(C.expiryInfo({ expiresAt: NOW + C.DAY }, NOW).state, "soon");
  assert.equal(C.expiryInfo({ expiresAt: NOW + 60000 }, NOW).hours, 1);
  assert.equal(C.expiryInfo({ expiresAt: NOW - 1 }, NOW).state, "expired");
  assert.equal(C.expiryInfo({}, NOW).state, "none");
});
test("extend: 3 days from now by default", () => {
  assert.equal(C.extendedExpiry(NOW), NOW + 3 * C.DAY);
  assert.equal(C.extendedExpiry(NOW, 7), NOW + 7 * C.DAY);
  assert.equal(C.isExpired({ expiresAt: C.extendedExpiry(NOW) }, NOW), false);
});

/* ---------- overview (A2) ---------- */
test("overview order: active sets first, newest change on top, expired below", () => {
  const sets = {
    old:     { name: "Old active", updatedAt: NOW - 5000, expiresAt: NOW + C.DAY },
    gone:    { name: "Expired but recent", updatedAt: NOW - 10, expiresAt: NOW - 1 },
    fresh:   { name: "Fresh active", updatedAt: NOW - 100, expiresAt: NOW + C.DAY },
    forever: { name: "No expiry", updatedAt: NOW - 9000 },
  };
  assert.deepEqual(C.sortSets(sets, NOW).map(x => x.id), ["fresh", "old", "forever", "gone"]);
  assert.deepEqual(C.sortSets(null, NOW), []);
});
test("overview counts: questions, respondents of the current round, phase", () => {
  const a = C.q("A", 1, 5, "", ""), b = C.q("B", 1, 5, "", "");
  const poll = { config: { questions: [a, b] }, session: { phase: "voting", round: 2 }, votes: {
    p1: vote(2, { [a.id]: 3 }), p2: vote(2, {}), p3: vote(1, { [a.id]: 5 }), p4: vote(2, { [b.id]: 1 }) } };
  assert.deepEqual(C.pollStats(poll), { questions: 2, respondents: 2, phase: "running" });
  assert.equal(C.pollStats({ config: { questions: [a] }, session: { phase: "summary" } }).phase, "finished");
  assert.deepEqual(C.pollStats({}), { questions: 0, respondents: 0, phase: "lobby" });
  assert.equal(C.pollStats({ session: { phase: "voting" } }).phase, "lobby", "no questions = lobby");
});

/* ---------- maintenance (A8) ---------- */
test("duplicate: same content, new question ids, fresh expiry, independent of the original", () => {
  const cfg = { mode: "live", tlYellow: "Y?", tlRed: "R?", questions: [tl("One"), C.q("Two", 1, 5, "lo", "hi")] };
  const meta = C.newMeta({ name: "Board", header: "Board vote", accent: "#E8710A", category: "consent", joinUrl: "https://x.example/j" }, NOW - 9 * C.DAY);
  const d = C.duplicateSet(meta, cfg, NOW);
  assert.equal(d.meta.name, "Board (copy)"); assert.equal(d.meta.header, "Board vote"); assert.equal(d.meta.accent, "#E8710A"); assert.equal(d.meta.category, "consent");
  assert.equal(d.meta.expiresAt, NOW + 3 * C.DAY); assert.equal(d.meta.createdAt, NOW); assert.equal(d.meta.joinUrl, "");
  assert.deepEqual(d.config.questions.map(C.exportQ), cfg.questions.map(C.exportQ));
  assert.equal(d.config.mode, "live"); assert.equal(d.config.tlYellow, "Y?");
  d.config.questions.forEach((qu, i) => assert.notEqual(qu.id, cfg.questions[i].id));
  d.config.questions[0].options[0] = "changed"; d.config.questions[1].text = "changed";
  assert.equal(cfg.questions[0].options[0], "Consent"); assert.equal(cfg.questions[1].text, "Two");
});
test("questions export and 'create from file' give identical questions and set attributes", () => {
  const cfg = { mode: "batch", tlYellow: "Concern?", tlRed: "Objection?", questions: [tl("P1"), C.q("Pick", 1, 3, "", "", ["A", "B", "C"]), C.q("Scale", 0, 10, "low", "high")] };
  const meta = C.newMeta({ name: "Offsite", header: "Offsite 2026", accent: "#2E8540", category: "consent", named: "random" }, NOW);
  const file = JSON.parse(JSON.stringify(C.questionsExport(meta, cfg)));
  const back = C.parseQuestionsFile(file);
  assert.deepEqual(back.set, { name: "Offsite", header: "Offsite 2026", accent: "#2E8540", category: "consent", named: "random" });
  assert.equal(back.tlYellow, "Concern?"); assert.equal(back.tlRed, "Objection?");
  assert.deepEqual(back.questions.map(C.exportQ), cfg.questions.map(C.exportQ));
});
test("questions file: a plain list still works, rubbish is refused", () => {
  assert.equal(C.parseQuestionsFile([{ text: "x", min: 1, max: 5 }]).questions.length, 1);
  assert.equal(C.parseQuestionsFile([{ text: "x" }]).set, null);
  assert.throws(() => C.parseQuestionsFile({ nope: 1 }));
});
test("responses export: only the current round, yellow and red need their comment, set details included", () => {
  const t1 = tl("Proposal"), s1 = C.q("Scale", 1, 5, "", "");
  const votes = {
    a: vote(1, { [t1.id]: 1, [s1.id]: 4 }, {}, NOW - 300),
    b: vote(1, { [t1.id]: 3, [s1.id]: 2 }, { [t1.id]: "Too costly" }, NOW - 200),
    c: vote(1, { [t1.id]: 2 }, {}, NOW - 100),            // yellow without comment: not counted
    d: vote(2, { [t1.id]: 1 }),                           // other round
    e: vote(1, {}),                                       // joined, no answers
  };
  const p = C.resultsPayload({ setId: "abc12345", meta: C.newMeta({ name: "Team B", header: "Team B session", category: "consent" }, NOW),
    cfg: { questions: [t1, s1] }, ses: { round: 1 }, votes, now: NOW });
  assert.deepEqual(p.set, { id: "abc12345", name: "Team B", header: "Team B session", category: "consent" });
  assert.equal(p.title, "Team B session"); assert.equal(p.respondents, 3);
  assert.deepEqual(p.questions[0].counts, { 1: 1, 2: 0, 3: 1 });
  assert.equal(p.questions[1].mean, 3); assert.equal(p.questions[1].answers, 2);
  assert.deepEqual(p.answers.map(r => r.respondent), ["R01", "R02", "R03"]);
  assert.equal(p.answers[1].texts[t1.id], "Too costly");
  const csv = C.resultsCSV(p).replace(/^﻿/, "").split("\r\n");
  assert.equal(csv[0], "respondent,question_nr,question,value,label,comment,confidence,set,header,category,action,owner,deadline");
  assert.ok(csv.includes('"R02",1,"Proposal",3,"Bezwaar","Too costly",,"Team B","Team B session","consent","","",'));
  assert.equal(csv.length, 1 + 5);
});
test("file names: a set name becomes a safe slug", () => {
  assert.equal(C.slug("MT offsite, team B!"), "mt-offsite-team-b");
  assert.equal(C.slug("Café Zürich"), "cafe-zurich");
  assert.equal(C.slug("  "), "set");
});

/* ---------- accent colour (A5) ---------- */
const HEX = /^#[0-9A-F]{6}$/;
const hueDist = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
test("accent: hex values are normalised or refused", () => {
  assert.equal(C.normHex("#e8710a"), "#E8710A"); assert.equal(C.normHex("e8710a"), "#E8710A"); assert.equal(C.normHex("#abc"), "#AABBCC");
  assert.equal(C.normHex("orange"), null); assert.equal(C.normHex(""), null);
});
test("accent: colour conversion round-trips", () => {
  for (const hex of ["#5A3BD6", "#E8710A", "#2E8540", "#FFFFFF", "#000000", "#475569"]) {
    const o = C.hexToOklch(hex); assert.equal(C.oklchToHex(o.L, o.C, o.h), hex);
  }
  assert.ok(Math.abs(C.contrast("#000000", "#FFFFFF") - 21) < 0.01);
});
test("accent: the default purple needs no overrides, so those sets render exactly as before", () => {
  assert.equal(C.themeCSS("#5A3BD6"), ""); assert.equal(C.themeCSS(undefined), ""); assert.equal(C.themeCSS("#5a3bd6"), "");
  assert.notEqual(C.themeCSS("#E8710A"), "");
});
test("accent: every preset keeps button text and accent-coloured text readable, light and dark", () => {
  assert.equal(C.ACCENT_PRESETS.length, 8); assert.equal(C.ACCENT_PRESETS[0][1], C.DEFAULT_ACCENT);
  for (const [name, hex] of C.ACCENT_PRESETS) for (const dark of [false, true]) {
    const v = C.themeVars(hex, dark), where = `${name} ${dark ? "dark" : "light"}`;
    Object.entries(v).forEach(([k, x]) => assert.match(x, HEX, `${where} --${k}`));
    assert.ok(C.contrast(v["accent-ink"], v.accent) >= 4.5, `${where}: text on primary button ${C.contrast(v["accent-ink"], v.accent).toFixed(2)}`);
    assert.ok(C.contrast(v["accent-text"], v.surface) >= 4.5, `${where}: accent text on card`);
    assert.ok(C.contrast(v.ink, v.surface) >= 12, `${where}: body text`);
    assert.ok(C.contrast(v["ink-2"], v.surface) >= 4.5, `${where}: secondary text`);
    if (dark) assert.ok(C.contrast(v.accent, v.surface) >= 4.5, `${where}: accent against surface`);
    else assert.equal(v.accent, hex, `${where}: the chosen colour is used as is`);
  }
});
test("accent: awkward colours (yellow, white, black) still give readable buttons and text", () => {
  for (const hex of ["#FFD400", "#FFFFFF", "#000000", "#00FF00", "#808080"]) for (const dark of [false, true]) {
    const v = C.themeVars(hex, dark);
    assert.ok(C.contrast(v["accent-ink"], v.accent) >= 4.5, `${hex} ${dark}: button`);
    assert.ok(C.contrast(v["accent-text"], v.surface) >= 4.5, `${hex} ${dark}: accent text`);
  }
});
test("accent: with orange or green no purple is left in tints, ramp or accent", () => {
  const purple = C.hexToOklch("#5A3BD6").h;
  for (const hex of ["#E8710A", "#2E8540"]) for (const dark of [false, true]) {
    const v = C.themeVars(hex, dark), target = C.hexToOklch(hex).h;
    for (const [k, x] of Object.entries(v)) { const o = C.hexToOklch(x); if (o.C < 0.004) continue; // near-grey has no hue to speak of
      assert.ok(hueDist(o.h, target) < 0.35, `${hex} ${dark ? "dark" : "light"} --${k} ${x} is off-hue`);
      assert.ok(hueDist(o.h, purple) > 1, `${hex} --${k} ${x} is still purple`); }
  }
});
test("accent: tints keep the lightness of the purple original, cards stay white in light mode", () => {
  const v = C.themeVars("#E8710A", false);
  assert.equal(v.surface, "#FFFFFF");
  for (const k of ["bg", "surface-2", "line", "ink", "muted"]) assert.ok(Math.abs(C.hexToOklch(v[k]).L - C.hexToOklch(C.REF.light[k]).L) < 0.02, k);
  for (let i = 1; i < 10; i++) assert.ok(C.relLum(v["r" + i]) > C.relLum(v["r" + (i + 1)]), "ramp runs light to dark");
  const d = C.themeVars("#E8710A", true);
  for (let i = 1; i < 10; i++) assert.ok(C.relLum(d["r" + i]) < C.relLum(d["r" + (i + 1)]), "dark ramp runs dark to light");
});
test("accent: a grey accent gives a grey page, not a purple one", () => {
  const v = C.themeVars("#808080", false);
  for (const k of ["bg", "surface-2", "line", "r5"]) assert.ok(C.hexToOklch(v[k]).C < 0.004, k);
});
test("accent: stylesheet has a light block and both dark blocks", () => {
  const css = C.themeCSS("#2E8540");
  assert.match(css, /^:root\{--bg:#[0-9A-F]{6};/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{/);
  assert.match(css, /:root\[data-theme="dark"\]\{/);
  assert.ok(!/--good|--warn/.test(css), "status colours do not follow the accent");
});

/* ---------- content texts ---------- */
test("tx: a plain string today, the first language of a map later (E1)", () => {
  assert.equal(tx("Hallo"), "Hallo"); assert.equal(tx(null), ""); assert.equal(tx({ nl: "Hallo", en: "Hello" }), "Hallo"); assert.equal(tx(5), "5");
});
function tx(v) { return C.tx(v); }

/* ---------- existing behaviour that moved into core ---------- */
test("config from the database is normalised (objects instead of arrays, missing list)", () => {
  assert.deepEqual(C.normConfig(null), C.emptyConfig());
  const c = C.normConfig({ mode: "live", questions: { 0: { id: "a", text: "x", options: { 0: "A", 1: "B" } } } });
  assert.ok(Array.isArray(c.questions)); assert.deepEqual(c.questions[0].options, ["A", "B"]); assert.equal(c.mode, "live");
  assert.deepEqual(C.normConfig({ mode: "batch" }).questions, []);
});
test("statistics: mean, median, spread and counts", () => {
  const s = C.stats([1, 2, 2, 5], 1, 5);
  assert.equal(s.mean, 2.5); assert.equal(s.median, 2); assert.equal(s.mode, 2); assert.deepEqual(s.counts, { 1: 1, 2: 2, 3: 0, 4: 0, 5: 1 });
  assert.deepEqual(C.stats([], 1, 5), { n: 0 });
});
test("presence: someone without answers counts for 2.5 minutes, the presenter's own device never", () => {
  const votes = { a: vote(1, {}, {}, NOW - 1000), b: vote(1, {}, {}, NOW - C.PRESENCE_MS - 1), host: vote(1, {}, {}, NOW), old: vote(1, { q: 1 }, {}, NOW - 9e6) };
  assert.deepEqual(Object.keys(C.roundVotes(votes, 1, NOW, "host")).sort(), ["a", "old"]);
});
test("CSV import: header row, semicolons, quoted text, question types", () => {
  const qs = C.csvToQuestions('text;type;options;min;max\n"Vote; now";traffic;;;\nPick;options;A|B|C;;\nRate;;;0;10\n');
  assert.equal(qs.length, 3); assert.equal(qs[0].text, "Vote; now"); assert.equal(qs[0].kind, "traffic");
  assert.deepEqual(qs[1].options, ["A", "B", "C"]); assert.equal(qs[2].min, 0); assert.equal(qs[2].max, 10);
  assert.equal(C.csvToQuestions("Just a statement\nAnother one").length, 2);
});

/* ---------- rules for later items, tested from the start ---------- */
test("C2 status rule: any red = red, else any yellow = yellow, all green = green, no votes = none", () => {
  assert.equal(C.trafficStatus({ g: 5, y: 1, r: 0 }), "yellow");
  assert.equal(C.trafficStatus({ g: 5, y: 0, r: 1 }), "red");
  assert.equal(C.trafficStatus({ g: 5, y: 3, r: 1 }), "red");
  assert.equal(C.trafficStatus({ g: 6, y: 0, r: 0 }), "green");
  assert.equal(C.trafficStatus({ g: 0, y: 0, r: 0 }), "none");
  assert.equal(C.trafficStatus(undefined), "none");
});
test("C1 revision filter: only answers given on the current version of a proposal count", () => {
  const qu = tl("Proposal");
  const votes = {
    a: { round: 1, answers: { [qu.id]: 3 }, texts: { [qu.id]: "No" } },                       // version 1 (nothing recorded)
    b: { round: 1, answers: { [qu.id]: 1 }, revs: { [qu.id]: 2 } },                           // version 2
    c: { round: 1, answers: { [qu.id]: 2 }, texts: { [qu.id]: "Hmm" }, revs: { [qu.id]: 2 } },
    d: { round: 1, answers: { [qu.id]: 2 }, revs: { [qu.id]: 2 } },                           // yellow without comment
  };
  assert.deepEqual(C.trafficCounts(votes, qu, 1), { g: 0, y: 0, r: 1 });
  assert.deepEqual(C.trafficCounts(votes, qu, 2), { g: 1, y: 1, r: 0 });
  assert.deepEqual(C.trafficCounts(votes, qu, 3), { g: 0, y: 0, r: 0 });
  assert.equal(C.trafficStatus(C.trafficCounts(votes, qu, 2)), "yellow");
  assert.equal(C.answerIsCurrent({}, qu.id, undefined), true);
});
test("D1 random names: letter plus one digit, unique within the set", () => {
  assert.equal(C.randomName(new Set(), seq(1 / 26 + 0.001, 0.59)), "b5");
  assert.equal(C.randomName([], seq(15 / 26 + 0.001, 0.03)), "p0");
  assert.equal(C.randomName(new Set(["b5"]), seq(1 / 26 + 0.001, 0.59, 10 / 26 + 0.001, 0.12)), "k1", "draws again on a collision");
  const taken = new Set();
  for (let i = 0; i < 200; i++) { const n = C.randomName(taken); assert.match(n, /^[a-z][0-9]$/); assert.ok(!taken.has(n)); taken.add(n); }
  const all = new Set(); for (let l = 0; l < 26; l++) for (let n = 0; n < 10; n++) all.add(String.fromCharCode(97 + l) + String(n));
  assert.equal(C.randomName(all), null, "all 260 names in use");
  all.delete("z9"); assert.equal(C.randomName(all), "z9", "finds the last free name");
});

/* ---------- categories (B1) ---------- */
const kinds = { scale: () => C.q("S", 1, 5, "", ""), options: () => C.q("O", 1, 2, "", "", ["A", "B"]), open: () => C.qOpen("Open"),
  traffic: () => tl("T"), dilemma: () => C.qDilemma("D", ["A", "B"]) };
test("B1 category table: which question types each category offers and what '+ Add question' gives", () => {
  assert.deepEqual(C.catRules("generic").kinds, ["scale", "options", "open"]);
  assert.deepEqual(C.catRules("consent").kinds, ["scale", "options", "open", "traffic"]);
  assert.deepEqual(C.catRules("dilemma").kinds, ["scale", "options", "open", "dilemma"]);
  assert.equal(C.kindOf(C.qNew(C.catRules("generic").add)), "scale");
  assert.equal(C.kindOf(C.qNew(C.catRules("consent").add)), "traffic");
  assert.equal(C.kindOf(C.qNew(C.catRules("dilemma").add)), "dilemma");
  assert.deepEqual(C.catRules("unknown"), C.catRules("generic"));
  for (const k of Object.keys(kinds)) assert.equal(C.kindOf(kinds[k]()), k);
});
test("B1 imports: questions of a type the category lacks are skipped, with a message that says how many and why", () => {
  const all = [kinds.scale(), kinds.traffic(), kinds.traffic(), kinds.dilemma(), kinds.open(), kinds.options()];
  const g = C.filterForCategory("generic", all);
  assert.deepEqual(g.kept.map(C.kindOf), ["scale", "open", "options"]); assert.deepEqual(g.skipped, { traffic: 2, dilemma: 1 });
  assert.equal(C.skippedMessage("generic", g.skipped), "2 traffic light questions and 1 dilemma question skipped: that type is not available in a Generic set.");
  assert.deepEqual(C.filterForCategory("consent", all).skipped, { dilemma: 1 });
  assert.deepEqual(C.filterForCategory("dilemma", all).skipped, { traffic: 2 });
  assert.equal(C.skippedMessage("consent", {}), "");
});
test("B1 changing category: only when every existing question fits, otherwise it names the questions", () => {
  const qs = [kinds.scale(), kinds.traffic(), kinds.open(), kinds.traffic()];
  assert.deepEqual(C.categoryBlockers("consent", qs), []);
  assert.deepEqual(C.categoryBlockers("generic", qs), [{ n: 2, kind: "traffic" }, { n: 4, kind: "traffic" }]);
  assert.equal(C.blockerMessage("generic", C.categoryBlockers("generic", qs)), "This set cannot become Generic: question 2, 4 are traffic light questions. Change or remove them first.");
  assert.match(C.blockerMessage("dilemma", C.categoryBlockers("dilemma", [kinds.traffic()])), /question 1 is a traffic light question/);
});
test("B1 CSV import knows the new types", () => {
  const qs = C.csvToQuestions("text,type,options\nWhy?,open,\nWhich way?,dilemma,Left|Right\nVote,traffic,\n");
  assert.deepEqual(qs.map(C.kindOf), ["open", "dilemma", "traffic"]); assert.deepEqual(qs[1].options, ["Left", "Right"]); assert.deepEqual(qs[1].conf, C.DEFAULT_CONF);
  assert.deepEqual(C.filterForCategory("generic", qs).kept.map(C.kindOf), ["open"]);
});
test("editor: changing the type reshapes a question and keeps what carries over", () => {
  const s = C.q("Text", 0, 10, "lo", "hi");
  const o = C.shapeQuestion({ ...s, options: ["A", "B"] }, "options");
  assert.equal(o.kind, "options"); assert.equal(o.max, 2); assert.equal(o.id, s.id); assert.equal(o.text, "Text");
  const d = C.shapeQuestion(o, "dilemma"); assert.deepEqual(d.options, ["A", "B"]); assert.deepEqual(d.conf, C.DEFAULT_CONF);
  const back = C.shapeQuestion(d, "scale"); assert.equal(back.kind, undefined); assert.equal(back.min, 1); assert.equal(back.max, 5); assert.equal(back.options, undefined);
  assert.deepEqual(C.shapeQuestion(s, "scale"), { id: s.id, text: "Text", min: 0, max: 10, lo: "lo", hi: "hi" });
  assert.equal(C.shapeQuestion({ id: "x", text: "  " }, "open").text, "Untitled question");
  assert.equal(C.shapeQuestion({ id: "x", text: "t", maxLen: 5 }, "open").maxLen, 20);
  assert.deepEqual(C.questionProblems([C.qNew("options"), s, C.qNew("dilemma"), d]), ["Question 1: add at least two options.", "Question 3: a dilemma has exactly two options."]);
});

/* ---------- open question (B2) ---------- */
test("B2 open question: an answer is its text; empty or blank does not count", () => {
  const qu = C.qOpen("Why?");
  assert.equal(qu.maxLen, 500); assert.equal(C.isOpt(qu), false);
  assert.equal(C.validAns({ answers: { [qu.id]: 1 }, texts: { [qu.id]: "Because" } }, qu), 1);
  assert.equal(C.validAns({ answers: { [qu.id]: 1 }, texts: { [qu.id]: "   " } }, qu), null);
  assert.equal(C.validAns({ answers: { [qu.id]: 1 } }, qu), null);
});
test("B2 open answers survive JSON and CSV with line breaks, quotes and emoji", () => {
  const qu = C.qOpen("Feedback"), text = 'Line one\nLine "two", with a comma 🎉';
  const votes = { a: vote(1, { [qu.id]: 1 }, { [qu.id]: text }, NOW - 20), b: vote(1, { [qu.id]: 1 }, { [qu.id]: "Short" }, NOW - 10), c: vote(1, {}, {}, NOW) };
  const p = JSON.parse(JSON.stringify(C.resultsPayload({ setId: "s", meta: C.newMeta({ name: "S" }, NOW), cfg: { questions: [qu] }, ses: { round: 1 }, votes, now: NOW })));
  assert.equal(p.questions[0].kind, "open"); assert.equal(p.questions[0].answers, 2); assert.deepEqual(p.questions[0].texts, [text, "Short"]);
  assert.equal(p.questions[0].mean, null); assert.equal(p.questions[0].mostChosen, null);
  assert.equal(p.answers[0].texts[qu.id], text);
  const rows = C.parseCSV(C.resultsCSV(p));
  assert.equal(rows.length, 3); assert.deepEqual(rows[1].slice(0, 7), ["R01", "1", "Feedback", "", "", text, ""]);
});

/* ---------- dilemma question (B3) ---------- */
test("B3 dilemma: counts only with both the choice and a confidence inside the scale", () => {
  const qu = C.qDilemma("Which way?", ["A", "B"]);
  assert.equal(C.validAns({ answers: { [qu.id]: 1 }, conf: { [qu.id]: 4 } }, qu), 1);
  assert.equal(C.validAns({ answers: { [qu.id]: 1 } }, qu), null, "no confidence");
  assert.equal(C.validAns({ conf: { [qu.id]: 4 } }, qu), null, "no choice");
  assert.equal(C.validAns({ answers: { [qu.id]: 1 }, conf: { [qu.id]: 9 } }, qu), null, "confidence outside the scale");
});
test("B3 dilemma result: 3 on A (5, 4, 3) and 1 on B (2) gives A 3 / 4.0, B 1 / 2.0, overall 3.5", () => {
  const qu = C.qDilemma("Which way?", ["A", "B"]), v = (a, c) => ({ round: 1, answers: { [qu.id]: a }, conf: { [qu.id]: c }, t: NOW });
  const votes = { p1: v(1, 5), p2: v(1, 4), p3: v(1, 3), p4: v(2, 2), half: { round: 1, answers: { [qu.id]: 2 }, t: NOW } };
  const ds = C.dilemmaStats(votes, qu);
  assert.equal(ds.n, 4); assert.equal(ds.mean, 3.5); assert.equal(ds.mode, 1);
  assert.equal(ds.by[1].n, 3); assert.equal(ds.by[1].mean, 4); assert.equal(ds.by[2].n, 1); assert.equal(ds.by[2].mean, 2);
  assert.deepEqual(ds.by[1].dist, { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
  const p = C.resultsPayload({ setId: "s", meta: C.newMeta({ name: "S", category: "dilemma" }, NOW), cfg: { questions: [qu] }, ses: { round: 1 }, votes, now: NOW });
  assert.equal(p.questions[0].kind, "dilemma"); assert.equal(p.questions[0].answers, 4);
  assert.deepEqual(p.questions[0].confidence, { mean: 3.5, byOption: [{ option: "A", count: 3, mean: 4 }, { option: "B", count: 1, mean: 2 }] });
  assert.equal(p.answers.filter(r => r.confidence[qu.id] != null).length, 4);
  const rows = C.parseCSV(C.resultsCSV(p)).slice(1).filter(r => r[6] !== "");
  assert.equal(rows.length, 4); assert.deepEqual(rows[0].slice(3, 7), ["1", "A", "", "5"]);
  assert.deepEqual(C.dilemmaStats({}, qu).mean, null);
});
test("B2/B3 questions file and saved results: open and dilemma questions come back the same", () => {
  const cfg = { questions: [C.qOpen("Why?", 300), C.qDilemma("Which?", ["Left", "Right"], { text: "Sure?", min: 1, max: 7, lo: "no", hi: "yes" })] };
  const back = C.parseQuestionsFile(JSON.parse(JSON.stringify(C.questionsExport(C.newMeta({ name: "D", category: "dilemma" }, NOW), cfg))));
  assert.deepEqual(back.questions.map(C.exportQ), cfg.questions.map(C.exportQ));
  assert.deepEqual(back.questions[1].conf, { text: "Sure?", min: 1, max: 7, lo: "no", hi: "yes" }); assert.equal(back.questions[0].maxLen, 300);
  const p = C.resultsPayload({ setId: "s", meta: C.newMeta({ name: "D" }, NOW), cfg, ses: { round: 1 }, votes: {}, now: NOW });
  const revived = p.questions.map(C.reviveQuestion);
  assert.deepEqual(revived.map(q => q.id), cfg.questions.map(q => q.id), "review mode keeps the ids, so answers still match");
  assert.deepEqual(revived.map(C.exportQ), cfg.questions.map(C.exportQ));
  assert.equal(C.kindOf(C.qFromObj({ text: "x", kind: "dilemma", options: ["only one"] })), "dilemma");
  assert.equal(C.qFromObj({ text: "x", kind: "dilemma", options: ["only one"] }).options.length, 2, "a dilemma always has at least two options");
});

/* ---------- named respondents (D1, D2) ---------- */
test("D1 typed names: 2 to 30 characters, trimmed, unique without regard to case", () => {
  assert.equal(C.cleanName("  Anna   de  Vries "), "Anna de Vries"); assert.equal(C.cleanName("x".repeat(50)).length, 30);
  assert.match(C.nameProblem("a", []), /at least 2/); assert.match(C.nameProblem("   ", []), /at least 2/);
  assert.match(C.nameProblem("anna", ["Bob", "ANNA"]), /already in use/);
  assert.equal(C.nameProblem("Anna", ["Bob"]), "");
  assert.deepEqual(C.otherNames({ me: { name: "Me" }, a: { name: "Anna" }, b: {}, c: null }, "me"), ["Anna"]);
});
test("D1 same name claimed twice at the same moment: the later claim gives way, the earlier keeps it", () => {
  const votes = { p_a: { name: "k12", nameAt: 100 }, p_b: { name: "K12", nameAt: 200 }, p_c: { name: "b59", nameAt: 50 } };
  assert.equal(C.mustYieldName(votes, "p_b", "K12", 200), true);
  assert.equal(C.mustYieldName(votes, "p_a", "k12", 100), false);
  assert.equal(C.mustYieldName(votes, "p_c", "b59", 50), false);
  const tie = { p_a: { name: "k12", nameAt: 100 }, p_b: { name: "k12", nameAt: 100 } };
  assert.equal(C.mustYieldName(tie, "p_a", "k12", 100), false); assert.equal(C.mustYieldName(tie, "p_b", "k12", 100), true, "exactly one of two gives way");
});
test("D1 thirty devices joining a random set get thirty different names", () => {
  const votes = {};
  for (let i = 0; i < 30; i++) { const pid = "p_" + i, n = C.randomName(new Set(C.otherNames(votes, pid))); votes[pid] = { name: n, nameAt: i }; }
  const names = Object.values(votes).map(v => v.name);
  assert.equal(new Set(names).size, 30); names.forEach(n => assert.match(n, /^[a-z][0-9]$/));
});
test("D1 joined: in a named set a device without a name and without answers does not count", () => {
  const votes = { a: vote(1, {}, {}, NOW), b: { ...vote(1, {}, {}, NOW), name: "k12" }, c: vote(1, { q: 1 }, {}, NOW) };
  assert.deepEqual(Object.keys(C.roundVotes(votes, 1, NOW, null, "random")).sort(), ["b", "c"]);
  assert.deepEqual(Object.keys(C.roundVotes(votes, 1, NOW, null, "no")).sort(), ["a", "b", "c"]);
});
test("D2 exports: names instead of R01 in a named set, and no name anywhere in an anonymous one", () => {
  const t1 = tl("Proposal"), votes = { a: { ...vote(1, { [t1.id]: 3 }, { [t1.id]: "No budget" }, NOW - 2), name: "k12" }, b: { ...vote(1, { [t1.id]: 1 }, {}, NOW - 1), name: "b59" } };
  const mk = named => C.resultsPayload({ setId: "s", meta: C.newMeta({ name: "S", category: "consent", named }, NOW), cfg: { questions: [t1] }, ses: { round: 1 }, votes, now: NOW });
  const named = mk("random");
  assert.deepEqual(named.answers.map(r => r.respondent), ["k12", "b59"]); assert.deepEqual(named.questions[0].comments, [{ v: 3, text: "No budget", name: "k12" }]);
  assert.ok(C.resultsCSV(named).includes('"k12",1,"Proposal",3,"Bezwaar","No budget"')); assert.ok(C.consentMarkdown(named).includes("- (k12) No budget"));
  const anon = mk("no"), all = JSON.stringify(anon) + C.resultsCSV(anon) + C.consentMarkdown(anon);
  assert.deepEqual(anon.answers.map(r => r.respondent), ["R01", "R02"]); assert.ok(!/k12|b59/.test(all)); assert.ok(C.consentMarkdown(anon).includes("- No budget"));
});

/* ---------- consent workflow (C1 to C4) ---------- */
const tv = (qu, a, text, extra) => ({ round: 1, answers: { [qu.id]: a }, texts: text ? { [qu.id]: text } : {}, t: NOW, ...(extra || {}) });
test("C1 edit: old text, counts and comments go to the history, the new text is the next version and starts at zero", () => {
  const qu = tl("Original text");
  const votes = { a: tv(qu, 1), b: tv(qu, 3, "Too costly", { name: "k12", t: NOW - 5 }), c: tv(qu, 2, "Timing?", { name: "b59", t: NOW - 3 }), d: tv(qu, 2) };
  const v2 = C.editQuestion(qu, "  Cheaper text ", votes, "random", NOW);
  assert.equal(v2.text, "Cheaper text"); assert.equal(v2.rev, 2); assert.equal(v2.id, qu.id);
  assert.deepEqual(v2.history, [{ rev: 1, text: "Original text", counts: { g: 1, y: 1, r: 1 }, comments: [{ v: 3, text: "Too costly", name: "k12" }, { v: 2, text: "Timing?", name: "b59" }], t: NOW }]);
  assert.deepEqual(C.trafficCounts(votes, v2, v2.rev), { g: 0, y: 0, r: 0 }, "the counter starts at 0");
  assert.deepEqual(C.trafficComments(votes, v2, "random"), [], "old comments do not show on the new version");
  assert.equal(C.validAns(votes.a, v2), null);
  const again = { ...votes, a: tv(v2, 1, "", { revs: { [qu.id]: 2 } }) };
  assert.deepEqual(C.trafficCounts(again, v2, 2), { g: 1, y: 0, r: 0 });
  const v3 = C.editQuestion(v2, "Third text", again, "no", NOW + 1);
  assert.equal(v3.rev, 3); assert.equal(v3.history.length, 2); assert.deepEqual(v3.history[1].counts, { g: 1, y: 0, r: 0 });
  assert.equal(C.editQuestion(qu, "   ", votes, "no", NOW).text, "Original text", "an empty text keeps the old one; the vote still starts again");
});
test("C1 the editor and a duplicate treat versions correctly", () => {
  const v2 = C.editQuestion(tl("One"), "Two", {}, "no", NOW);
  const kept = C.shapeQuestion(v2, "traffic"); assert.equal(kept.rev, 2); assert.equal(kept.history.length, 1);
  assert.equal(C.shapeQuestion(v2, "scale").rev, undefined);
  const copy = C.duplicateSet(C.newMeta({ name: "S" }, NOW), { questions: [v2] }, NOW).config.questions[0];
  assert.equal(copy.rev, undefined); assert.equal(copy.history, undefined); assert.equal(copy.text, "Two");
  const cfg = C.normConfig({ questions: [{ ...v2, history: { 0: { rev: 1, text: "One" } } }] });
  assert.deepEqual(cfg.questions[0].history, [{ rev: 1, text: "One", counts: { g: 0, y: 0, r: 0 }, comments: [] }], "history from the database is repaired");
  const cleared = C.clearHistory({ questions: [v2] }).questions[0]; assert.equal(cleared.rev, undefined); assert.equal(cleared.text, "Two");
});
test("C2 the light is fixed when the presenter leaves the proposal; a later vote does not change it", () => {
  const qu = tl("P"), votes = { a: tv(qu, 1), b: tv(qu, 1), c: tv(qu, 2, "hmm") };
  const outcome = C.fixOutcome({}, qu, votes, NOW);
  assert.deepEqual(outcome[qu.id], { status: "yellow", rev: 1, counts: { g: 2, y: 1, r: 0 }, t: NOW });
  const later = { ...votes, d: tv(qu, 3, "late objection") };
  assert.equal(C.questionOutcome(qu, { outcome }, later).status, "yellow"); assert.equal(C.questionOutcome(qu, { outcome }, later).fixed, true);
  assert.equal(C.questionOutcome(qu, {}, later).status, "red", "without a fixed light the votes as they stand decide");
  assert.equal(C.fixOutcome(outcome, qu, later, NOW + 1)[qu.id].status, "red", "leaving the proposal again recalculates");
  const v2 = C.editQuestion(qu, "P2", later, "no", NOW);
  assert.equal(C.questionOutcome(v2, { outcome }, later).status, "none", "a light of an earlier version does not stand for the new one");
});
function consentSession() { // 8 proposals: 5 green, 2 yellow, 1 red (edited once)
  const qs = Array.from({ length: 8 }, (_, i) => tl("Proposal " + (i + 1))), votes = { a: { round: 1, answers: {}, texts: {}, t: NOW - 3, name: "k12" }, b: { round: 1, answers: {}, texts: {}, t: NOW - 2, name: "b59" }, c: { round: 1, answers: {}, texts: {}, t: NOW - 1, name: "p03" } };
  qs.forEach((qu, i) => { Object.values(votes).forEach(v => { v.answers[qu.id] = 1; }); });
  votes.a.answers[qs[2].id] = 2; votes.a.texts[qs[2].id] = "Concern | with a pipe";
  votes.b.answers[qs[5].id] = 2; votes.b.texts[qs[5].id] = "Second\nline";
  qs[6] = C.editQuestion(qs[6], "Proposal 7, rewritten\nwith a second line", { x: { round: 1, answers: { [qs[6].id]: 3 }, texts: { [qs[6].id]: "First objection" }, t: NOW - 9, name: "k12" } }, "random", NOW - 8);
  Object.values(votes).forEach(v => { v.revs = { [qs[6].id]: 2 }; });
  votes.c.answers[qs[6].id] = 3; votes.c.texts[qs[6].id] = "Still too costly";
  votes.a.answers[qs[6].id] = 2; votes.a.texts[qs[6].id] = "Needs a date";
  let outcome = {}; qs.forEach(qu => { outcome = C.fixOutcome(outcome, qu, votes, NOW); });
  return { cfg: { questions: [...qs, C.q("How was it?", 1, 5, "", "")] }, ses: { round: 1, outcome }, votes };
}
test("C3 closing overview: 8 proposals give 8 lights, 3 of them in the details, red first", () => {
  const { cfg, ses, votes } = consentSession(), rows = C.consentRows(cfg, ses, votes, "random");
  assert.equal(rows.length, 9); assert.equal(rows[8].status, undefined, "other question types have no light");
  assert.deepEqual(C.consentTotals(rows), { green: 5, yellow: 2, red: 1, none: 0 });
  assert.deepEqual(rows.filter(r => r.kind === "traffic").map(r => r.status), ["green", "green", "yellow", "green", "green", "yellow", "red", "green"]);
  const r7 = rows[6]; assert.equal(r7.text, "Proposal 7, rewritten\nwith a second line"); assert.equal(r7.edited, true); assert.equal(r7.rev, 2);
  assert.deepEqual(r7.comments, [{ v: 2, text: "Needs a date", name: "k12" }, { v: 3, text: "Still too costly", name: "p03" }]); assert.equal(r7.history.length, 1);
  const allGreen = C.consentRows({ questions: [tl("x")] }, {}, { a: tv({ id: "nope" }, 1) }, "no"); assert.equal(C.consentTotals(allGreen).none, 1);
});
test("C4 Markdown export: overview table, details for yellow and red, earlier versions, all proposals", () => {
  const { cfg, ses, votes } = consentSession();
  const p = C.resultsPayload({ setId: "s", meta: C.newMeta({ name: "Board", header: "Board decisions", category: "consent", named: "random" }, NOW), cfg, ses, votes, now: NOW });
  const md = C.consentMarkdown(JSON.parse(JSON.stringify(p))), lines = md.split("\n");
  assert.equal(lines[0], "# Board decisions"); assert.match(lines[2], /^- Date: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.ok(lines.includes("- Question set: Board")); assert.ok(lines.includes("- Respondents: 3")); assert.ok(lines.includes("- Result: 5 green · 2 yellow · 1 red"));
  assert.ok(lines.includes("| # | Proposal | Status | Green | Yellow | Red | Edited |"));
  assert.ok(lines.includes("| 1 | Proposal 1 | green | 3 | 0 | 0 | no |"));
  assert.ok(lines.includes("| 7 | Proposal 7, rewritten with a second line | red | 1 | 1 | 1 | yes (v2) |"), "line breaks are flattened inside the table");
  assert.equal(lines.filter(l => /^\| \d+ \|/.test(l)).length, 8, "one table row per proposal, other question types are left out");
  const heads = lines.filter(l => l.startsWith("### ")); assert.deepEqual(heads, ["### 7. Red", "### 3. Yellow", "### 6. Yellow"]);
  assert.ok(md.includes("**Proposal (version 2)**\n\n> Proposal 7, rewritten\n> with a second line\n"), "block quotes keep their line breaks");
  assert.ok(md.includes("**Objections (1)**\n\n- (p03) Still too costly\n")); assert.ok(md.includes("**Concerns (1)**\n\n- (k12) Needs a date\n"));
  assert.ok(md.includes("**Earlier versions**\n\nVersion 1:\n\n> Proposal 7\n\n- Objection (k12): First objection\n"));
  assert.ok(md.includes("- (k12) Concern | with a pipe")); assert.ok(md.includes("- (b59) Second line"));
  assert.ok(md.includes("## All proposals\n\n1. Proposal 1\n")); assert.ok(md.includes("7. Proposal 7, rewritten\n   with a second line\n"));
  const comments = p.questions.flatMap(q => q.comments || []); assert.equal(comments.length, 4); comments.forEach(c => assert.ok(md.includes(c.text.replace(/\n/g, " "))));
  const long = C.consentMarkdown({ ...p, questions: [{ ...p.questions[0], text: "x".repeat(100) + " | y" }] });
  assert.ok(long.includes("| 1 | " + "x".repeat(80) + "… | green |"), "long texts are cut to 80 characters in the table");
  const green = C.consentMarkdown({ ...p, questions: p.questions.filter(q => q.status === "green") }); assert.ok(green.includes("## Details\n\nNo concerns or objections left.\n"));
});
test("C4 a saved results file gives the same Markdown again (review mode)", () => {
  const { cfg, ses, votes } = consentSession();
  const meta = C.newMeta({ name: "Board", category: "consent", named: "random" }, NOW);
  const p = JSON.parse(JSON.stringify(C.resultsPayload({ setId: "s", meta, cfg, ses, votes, now: NOW })));
  const qs = p.questions.map(C.reviveQuestion), outcome = C.reviveOutcome(p), back = {};
  p.answers.forEach((r, i) => { const a = {}; qs.forEach(qu => { if (Number.isFinite(r.answers[qu.id])) a[qu.id] = r.answers[qu.id]; });
    back["R" + i] = { round: 1, answers: a, texts: r.texts, revs: Object.fromEntries(qs.filter(qu => qu.rev > 1 && a[qu.id] != null).map(qu => [qu.id, qu.rev])), name: r.respondent, t: Date.parse(r.at) }; });
  assert.equal(qs[6].rev, 2); assert.equal(qs[6].history.length, 1); assert.equal(outcome[qs[6].id].status, "red");
  const p2 = C.resultsPayload({ setId: "s", meta, cfg: { questions: qs }, ses: { round: 1, outcome }, votes: back, now: NOW });
  assert.equal(C.consentMarkdown(p2), C.consentMarkdown(p));
});

/* ---------- follow-up actions (F1, F2) ---------- */
function actionSession() { // proposal 1: 1 red + 1 yellow; proposal 2: green only; proposal 3: 2 yellow + 1 red; plus an edited proposal 4 with one red on version 2
  const qs = [tl("First proposal"), tl("Second proposal"), tl("Third | proposal"), tl("Fourth")], id = i => qs[i].id;
  const votes = {
    p_a: { round: 1, name: "k1", t: NOW - 30, answers: { [id(0)]: 2, [id(1)]: 1, [id(2)]: 2 }, texts: { [id(0)]: "Concern A1", [id(2)]: "Concern A3" } },
    p_b: { round: 1, name: "b5", t: NOW - 20, answers: { [id(0)]: 3, [id(1)]: 1, [id(2)]: 3 }, texts: { [id(0)]: "Objection B1", [id(2)]: "Objection B3\nsecond line" } },
    p_c: { round: 1, name: "p0", t: NOW - 10, answers: { [id(0)]: 1, [id(1)]: 1, [id(2)]: 2 }, texts: { [id(2)]: "Concern C3" } },
  };
  qs[3] = C.editQuestion(qs[3], "Fourth, rewritten", { x: { round: 1, answers: { [id(3)]: 3 }, texts: { [id(3)]: "Old objection" }, t: 1 } }, "random", NOW - 50);
  votes.p_c.answers[id(3)] = 3; votes.p_c.texts[id(3)] = "New objection"; votes.p_c.revs = { [id(3)]: 2 };
  votes.p_a.answers[id(3)] = 3; votes.p_a.texts[id(3)] = "Objection on version 1";            // given on version 1: not a remark any more
  return { cfg: { questions: qs }, ses: { round: 1 }, votes, id };
}
test("F1 action list: one row per yellow or red remark on the final version, red first, grouped per proposal", () => {
  const { cfg, ses, votes, id } = actionSession(), G = C.actionGroups(cfg, ses, votes, "random", {});
  assert.deepEqual(G.map(g => [g.n, g.status, g.rows.length]), [[1, "red", 2], [3, "red", 3], [4, "red", 1]]);
  assert.deepEqual(G[1].rows.map(r => [r.v, r.name, r.text]), [[3, "b5", "Objection B3\nsecond line"], [2, "k1", "Concern A3"], [2, "p0", "Concern C3"]]);
  assert.deepEqual(G[2].rows.map(r => r.text), ["New objection"], "remarks on an earlier version are not listed");
  assert.equal(G[2].rows[0].key, id(3) + "_p_c_v2"); assert.equal(G[0].rows[0].key, id(0) + "_p_b_v1");
  assert.deepEqual(C.actionTotals(G), { total: 6, objections: 3, concerns: 3, action: 0, none: 0, open: 6, done: 0 });
  assert.equal(C.actionGroups(cfg, ses, votes, "no", {})[0].rows[0].name, undefined);
  assert.deepEqual(C.actionGroups({ questions: [tl("x")] }, {}, {}, "no", {}), []);
});
test("F1 a remark is handled with an action text or with 'no action needed'; the counter follows", () => {
  const { cfg, ses, votes, id } = actionSession();
  const actions = { [id(0) + "_p_b_v1"]: { action: " Recalculate ", owner: " Anna  de Vries ", due: "2026-12-01" }, [id(0) + "_p_a_v1"]: { none: true, action: "kept text" },
    [id(2) + "_p_b_v1"]: { owner: "Bob", due: "2026-11-25" }, [id(3) + "_p_c_v1"]: { action: "For version 1, must not attach to version 2" } };
  const G = C.actionGroups(cfg, ses, votes, "random", actions), t = C.actionTotals(G);
  assert.deepEqual([t.action, t.none, t.open, t.done, t.total], [1, 1, 4, 2, 6]);
  assert.deepEqual(G[0].rows.map(r => [r.state, r.action, r.owner, r.due]), [["action", "Recalculate", "Anna de Vries", "2026-12-01"], ["none", "kept text", "", ""]]);
  assert.equal(G[1].rows[0].state, "open", "an owner and a deadline without an action is not handled yet");
  assert.equal(G[2].rows[0].state, "open", "an action never moves to another version of the proposal");
  assert.deepEqual(C.cleanAction({ action: "x".repeat(400), owner: "y".repeat(80), due: "next week", none: 0 }), { action: "x".repeat(300), owner: "y".repeat(60), due: "", none: false, t: 0 });
  assert.equal(C.actionState(null), "open");
});
test("F2 actions Markdown: header counts, a table per proposal, and all actions by deadline", () => {
  const { cfg, ses, votes, id } = actionSession();
  const actions = { [id(0) + "_p_b_v1"]: { action: "Recalculate | the case", owner: "Anna", due: "2026-12-01" }, [id(0) + "_p_a_v1"]: { none: true },
    [id(2) + "_p_a_v1"]: { action: "Plan a review", owner: "Bob", due: "2026-11-25" }, [id(2) + "_p_c_v1"]: { action: "No date yet", owner: "Anna" } };
  const mk = named => JSON.parse(JSON.stringify(C.resultsPayload({ setId: "s", meta: C.newMeta({ name: "Board", header: "Board decisions", category: "consent", named }, NOW), cfg, ses, votes, actions, now: NOW })));
  const p = mk("random"), md = C.actionsMarkdown(p), lines = md.split("\n");
  assert.equal(lines[0], "# Board decisions: follow-up actions");
  assert.ok(lines.includes("- Remarks: 6 (3 objections, 3 concerns)")); assert.ok(lines.includes("- Handled: 3 with an action, 1 no action needed, 2 open"));
  assert.deepEqual(lines.filter(l => l.startsWith("### ")), ["### 1. Red", "### 3. Red", "### 4. Red"]);
  assert.ok(lines.includes("| Type | Remark | By | Action | Owner | Deadline |"));
  assert.ok(lines.includes("| Objection | Objection B1 | b5 | Recalculate \\| the case | Anna | 2026-12-01 |"), "pipes are escaped");
  assert.ok(lines.includes("| Concern | Concern A1 | k1 | No action needed |  |  |"));
  assert.ok(lines.includes("| Objection | Objection B3 second line | b5 | (open) |  |  |"), "line breaks are flattened, open remarks are marked");
  assert.ok(md.includes("### 3. Red\n\n> Third | proposal\n"));
  const dl = lines.slice(lines.indexOf("## Actions by deadline"));
  assert.deepEqual(dl.filter(l => /^\| (\d{4}|\s)/.test(l)), ["| 2026-11-25 | Bob | Plan a review | 3 |", "| 2026-12-01 | Anna | Recalculate \\| the case | 1 |", "|  | Anna | No date yet | 3 |"]);
  const rows = lines.filter(l => /^\| (Objection|Concern) \|/.test(l)); assert.equal(rows.length, 6, "every remark exactly once");
  const anon = C.actionsMarkdown(mk("no")); assert.ok(anon.includes("| Type | Remark | Action | Owner | Deadline |")); assert.ok(!/\| By \|/.test(anon)); assert.ok(!/k1|b5|p0/.test(anon));
  assert.ok(C.consentMarkdown(p).includes("## Actions\n\n| Deadline | Owner | Action | Proposal |"), "the outcome export carries the actions too");
  assert.ok(!C.consentMarkdown(mk2()).includes("## Actions"), "and leaves the section out when there are none");
  function mk2() { return C.resultsPayload({ setId: "s", meta: C.newMeta({ name: "Board", category: "consent" }, NOW), cfg, ses, votes, actions: {}, now: NOW }); }
  const empty = C.actionsMarkdown(C.resultsPayload({ setId: "s", meta: C.newMeta({ name: "B", category: "consent" }, NOW), cfg: { questions: [tl("x")] }, ses: {}, votes: {}, now: NOW }));
  assert.ok(empty.includes("No concerns or objections to follow up.")); assert.ok(empty.includes("No actions recorded."));
});
test("F2 JSON and CSV carry the actions, and a saved results file gives the same actions Markdown again", () => {
  const { cfg, ses, votes, id } = actionSession(), meta = C.newMeta({ name: "Board", category: "consent", named: "random" }, NOW);
  const actions = { [id(0) + "_p_b_v1"]: { action: "Recalculate", owner: "Anna", due: "2026-12-01" }, [id(0) + "_p_a_v1"]: { none: true }, [id(3) + "_p_c_v2"]: { action: "Rewrite again", owner: "Bob" } };
  const p = JSON.parse(JSON.stringify(C.resultsPayload({ setId: "s", meta, cfg, ses, votes, actions, now: NOW })));
  assert.deepEqual(p.answers.find(r => r.respondent === "b5").actions, { [id(0)]: { action: "Recalculate", owner: "Anna", due: "2026-12-01", none: false } });
  const csv = C.parseCSV(C.resultsCSV(p)), col = n => csv[0].indexOf(n), row = (who, nr) => csv.find(r => r[0] === who && r[1] === String(nr));
  assert.deepEqual([row("b5", 1)[col("action")], row("b5", 1)[col("owner")], row("b5", 1)[col("deadline")]], ["Recalculate", "Anna", "2026-12-01"]);
  assert.deepEqual([row("k1", 1)[col("action")], row("k1", 1)[col("owner")]], ["No action needed", ""]); assert.equal(row("p0", 2)[col("action")], "");
  const qs = p.questions.map(C.reviveQuestion), back = {};
  p.answers.forEach(r => { const a = {}; qs.forEach(qu => { if (Number.isFinite(r.answers[qu.id])) a[qu.id] = r.answers[qu.id]; });
    back[r.respondent] = { round: 1, answers: a, texts: r.texts, revs: Object.fromEntries(qs.filter(qu => qu.rev > 1 && a[qu.id] != null).map(qu => [qu.id, qu.rev])), name: r.respondent, t: Date.parse(r.at) }; });
  const revived = C.reviveActions(p, qs); assert.deepEqual(Object.keys(revived).sort(), [id(0) + "_b5_v1", id(0) + "_k1_v1", id(3) + "_p0_v2"].sort());
  const p2 = C.resultsPayload({ setId: "s", meta, cfg: { questions: qs }, ses: { round: 1, outcome: C.reviveOutcome(p) }, votes: back, actions: revived, now: NOW });
  assert.equal(C.actionsMarkdown(p2), C.actionsMarkdown(p));
});

/* ---------- links that cannot be guessed from the name (G4, open decision 14) ---------- */
test("new set id: the name as a slug plus four random characters", () => {
  const id = C.newSetId("MT offsite, team B!", null, seq(0, 0.5, 0.99, 0.25));
  assert.match(id, /^mt-offsite-team-b-[a-z2-9]{4}$/);
  assert.equal(id, "mt-offsite-team-b-" + C.randomTail(seq(0, 0.5, 0.99, 0.25)));
  assert.doesNotMatch(C.randomTail(), /[01oli]/);
  for (const n of ["Café Zürich", "x".repeat(60), "!!!", "  "]) assert.ok(C.SET_ID_RE.test(C.newSetId(n)), n);
  assert.equal(C.newSetId("x".repeat(60)).length, 40);
});
test("new set id: draws again while the id is taken", () => {
  const first = "team-b-" + C.randomTail(seq(0)), second = "team-b-" + C.randomTail(seq(0.5));
  assert.equal(C.newSetId("Team B", (id) => id === first, seq(0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5)), second);
});

test("presence: a heartbeat does not move an answered vote in time, so the comment order holds", () => {
  assert.deepEqual(C.presenceDoc(undefined, 2, NOW), { round: 2, answers: {}, t: NOW });
  assert.deepEqual(C.presenceDoc({ round: 1, answers: { q: 1 }, t: 5 }, 2, NOW), { round: 2, answers: {}, t: NOW });
  assert.deepEqual(C.presenceDoc({ round: 1, answers: {}, t: 5, name: "k1" }, 1, NOW), { round: 1, answers: {}, t: NOW, name: "k1" });
  const cur = { round: 1, answers: { q: 2 }, texts: { q: "Timing?" }, t: 5 }, next = C.presenceDoc(cur, 1, NOW);
  assert.deepEqual(next, cur); assert.notEqual(next, cur);
  assert.equal(C.presenceDoc({ round: 1, answers: { q: 2 } }, 1, NOW).t, NOW);
});

test("still writing: a comment that is being typed shows as a placeholder and counts as unfinished", () => {
  const qu = tl("Proposal"), T = C.TYPING_MS;
  const votes = {
    a: tv(qu, 1),
    b: tv(qu, 2, "Timing?", { t: NOW - 9 }),
    c: tv(qu, 3, "Too cost", { t: NOW - 5, typing: { [qu.id]: NOW - 1000 } }),   // changing a sent comment
    d: tv(qu, 2, "", { typing: { [qu.id]: NOW - 2000 } }),                        // first text, nothing sent yet
    e: tv(qu, 3),                                                                  // chose red, has not typed
    f: tv(qu, 2, "Done long ago", { t: NOW - 7, typing: { [qu.id]: NOW - T - 1 } }), // flag ran out
    g: tv(qu, 1, "", { typing: { [qu.id]: NOW } }),                               // green has no comment
  };
  assert.deepEqual(C.trafficComments(votes, qu, "no", NOW), [{ v: 2, text: "Timing?" }, { v: 2, text: "Done long ago" }, { v: 3, text: "Too cost", writing: true }]);
  assert.deepEqual(C.trafficComments(votes, qu, "no").map(c => c.writing), [undefined, undefined, undefined], "history and exports take the text as it is");
  assert.equal(C.trafficWriting(votes, qu, NOW), 3);
  assert.equal(C.trafficWriting(votes, { ...qu, rev: 2 }, NOW), 0, "votes on an earlier version do not count");
  assert.equal(C.typingExpiry(votes, NOW), T - 2000);
  assert.equal(C.typingExpiry({ a: votes.a, f: votes.f }, NOW), 0);
});
test("still writing: sending the text takes the flag away", () => {
  const doc = { round: 1, answers: { q1: 2, q2: 3 }, t: 5, typing: { q1: 10, q2: 11 } };
  assert.deepEqual(C.withoutTyping(doc, "q1"), { round: 1, answers: { q1: 2, q2: 3 }, t: 5, typing: { q2: 11 } });
  assert.deepEqual(C.withoutTyping(C.withoutTyping(doc, "q1"), "q2"), { round: 1, answers: { q1: 2, q2: 3 }, t: 5 });
  assert.deepEqual(doc.typing, { q1: 10, q2: 11 });
});

test("dilemma: exactly two options, more is refused when saving or creating from a file", () => {
  const ok = C.qDilemma("Build or buy?", ["Build", "Buy"]), three = C.qFromObj({ text: "Which?", kind: "dilemma", options: ["Left", "Right", "Wait"] }), one = C.shapeQuestion({ id: "x", text: "t", options: ["Only"] }, "dilemma");
  assert.deepEqual(C.questionProblems([ok]), []);
  assert.deepEqual(three.options, ["Left", "Right", "Wait"], "a file is not changed in silence");
  assert.deepEqual(C.questionProblems([ok, three, one, C.q("Pick", 1, 5, "", "", ["A", "B", "C"])]), ["Question 2: a dilemma has exactly two options (this one has 3).", "Question 3: a dilemma has exactly two options."]);
});

/* ---------- forged answers (backlog G) ---------- */
test("an answer outside the scale or the options does not count, so one forged vote cannot move a mean", () => {
  const sc = C.q("Scale", 1, 5, "lo", "hi"), mc = C.q("Pick", 1, 3, "", "", ["A", "B", "C"]);
  assert.equal(C.validAns({ answers: { [sc.id]: 5 } }, sc), 5);
  for (const bad of [0, 6, -1000, 999, 2.5]) assert.equal(C.validAns({ answers: { [sc.id]: bad } }, sc), null, String(bad));
  assert.equal(C.validAns({ answers: { [mc.id]: 4 } }, mc), null); assert.equal(C.validAns({ answers: { [mc.id]: 3 } }, mc), 3);
  const vals = [{ answers: { [sc.id]: 5 } }, { answers: { [sc.id]: 5 } }, { answers: { [sc.id]: -1000 } }].map((v) => C.validAns(v, sc)).filter(Number.isFinite);
  assert.equal(C.stats(vals, 1, 5).mean, 5);
});
test("qidMap lists the question ids that can be database keys; withQids adds it without touching the input", () => {
  const cfg = { mode: "batch", questions: [{ id: "q1a2b3" }, { id: "x.y" }, { id: "" }, null, { id: "imported_7" }] };
  assert.deepEqual(C.qidMap(cfg), { q1a2b3: true, imported_7: true });
  const out = C.withQids(cfg); assert.deepEqual(out.qids, { q1a2b3: true, imported_7: true }); assert.equal(cfg.qids, undefined);
  assert.deepEqual(C.qidMap(null), {}); assert.equal(C.withQids(null), null);
});

/* ---------- what the room is shown (backlog G8) ---------- */
test("visibleQids: nothing in the lobby or before a reveal; revealed ones, the one on screen in results, all in the summary", () => {
  const a = C.q("A", 1, 5, "", ""), b = C.q("B", 1, 5, "", ""), cfg = { questions: [a, b] };
  assert.deepEqual(C.visibleQids(cfg, { phase: "lobby", revealed: [a.id] }), []);
  assert.deepEqual(C.visibleQids(cfg, { phase: "voting", revealed: [] }), []);
  assert.deepEqual(C.visibleQids(cfg, { phase: "voting", revealed: [b.id] }), [b.id]);
  assert.deepEqual(C.visibleQids(cfg, { phase: "results", current: 0, revealed: [] }), [a.id]);
  assert.deepEqual(C.visibleQids(cfg, { phase: "summary", revealed: [] }), [a.id, b.id]);
});
test("shownVotes: one record per shown answer, not linkable to a device or across questions, same results as the full votes", () => {
  const a = C.q("A", 1, 5, "", ""), o = C.qOpen("Why?"), hidden = C.q("Hidden", 1, 5, "", ""), cfg = { questions: [a, o, hidden] };
  const votes = {
    uidAnn: { round: 1, t: 300, answers: { [a.id]: 4, [hidden.id]: 1 }, texts: { [o.id]: "late" }, name: "Ann", nameAt: 5 },
    uidBob: { round: 1, t: 100, answers: { [a.id]: 2, [o.id]: 1, [hidden.id]: 5 }, texts: { [o.id]: "early" } },
    uidOld: { round: 0, t: 50, answers: { [a.id]: 1 } },
    uidBad: { round: 1, t: 60, answers: { [a.id]: 99 } } };
  const ses = { phase: "voting", round: 1, revealed: [a.id, o.id] }, shown = C.shownVotes(cfg, ses, votes, "no"), json = JSON.stringify(shown);
  assert.equal(Object.keys(shown).length, 4, "two answers to A, two to the open question; old round, forged and hidden left out");
  assert.doesNotMatch(json, /uid|Ann|nameAt/); assert.ok(!json.includes(hidden.id));
  for (const d of Object.values(shown)) assert.equal(Object.keys(d.answers).length, 1, "a record never holds two questions");
  const vals = Object.values(shown).map((d) => C.validAns(d, a)).filter(Number.isFinite).sort();
  assert.deepEqual(vals, [2, 4]);
  const open = Object.values(shown).filter((d) => d.texts).sort((x, y) => x.t - y.t).map((d) => d.texts[o.id]);
  assert.deepEqual(open, ["early", "late"], "the order of answering survives, as a rank (t is 1, 2, …), not as a time");
  assert.ok(Object.values(shown).every((d) => d.t <= 2));
  assert.deepEqual(C.shownVotes(cfg, ses, votes, "no"), shown, "the same input gives the same keys, so republishing changes nothing");
  assert.match(JSON.stringify(C.shownVotes(cfg, ses, votes, "yes")), /"name":"Ann"/, "a named set shows names, as the presenter's screen does");
  assert.deepEqual(C.roundVotes(shown, 1, Date.now(), null, "no") && Object.keys(C.roundVotes(shown, 1, Date.now(), null, "no")).length, 4, "the screens' own filter keeps every record");
});
test("namesAsVotes turns the names list into what the name checks read", () => {
  const nv = C.namesAsVotes({ u1: { n: "Ann", at: 3 }, u2: { n: "" }, u3: null });
  assert.deepEqual(nv, { u1: { name: "Ann", nameAt: 3 } });
  assert.deepEqual(C.otherNames(nv, "me"), ["Ann"]); assert.equal(C.mustYieldName(nv, "me", "ann", 9), true);
});

test("icon: the round table takes the accent, and its drawing stays readable on it", () => {
  for (const [name, hex] of [...C.ACCENT_PRESETS, ["Yellow", "#F5D90A"], ["Light grey", "#D0D0D0"], ["Black", "#000000"]]) {
    const svg = C.iconSVG(hex), ink = /stroke="(#[0-9A-Fa-f]{6})"/.exec(svg)[1];
    assert.ok(svg.includes(`fill="${hex}"`), `${name}: tile is the accent`);
    assert.ok(C.contrast(ink, hex) >= 4.5, `${name}: drawing on tile`);
    assert.ok(!svg.includes("currentColor"), `${name}: fixed colours, for use as a file`);
  }
  assert.equal(C.iconSVG(undefined), C.iconSVG(C.DEFAULT_ACCENT));
  assert.equal(require("node:fs").readFileSync(require("node:path").join(__dirname, "../icons/icon.svg"), "utf8").trim(), C.iconSVG(C.DEFAULT_ACCENT));
});

/* ---------- sharing a set (backlog H6) ---------- */
const PEOPLE = { uidAnna: { email: "anna@example.com", name: "Anna", role: "admin" }, uidPiet: { email: "piet@example.com", name: "Piet", role: "user" }, uidSam: { email: "sam@example.com", name: "Sam", role: "user" },
  uidSam2: { email: "sam.jansen@example.com", name: "Sam", role: "user" }, uidOdd: { email: "odd@example.com", role: "presenter" }, "a/b": { role: "user" } };
test("the list of users is sorted by name and leaves out records without a valid role", () => {
  assert.deepEqual(C.userList(PEOPLE).map((u) => u.uid), ["uidAnna", "uidPiet", "uidSam2", "uidSam"]);
  assert.deepEqual(C.userList(PEOPLE)[0], { uid: "uidAnna", name: "Anna", email: "anna@example.com", role: "admin" });
  assert.deepEqual(C.userList(null), []);
  assert.equal(C.userLabel({ name: "Piet", email: "piet@example.com" }), "Piet <piet@example.com>"); assert.equal(C.userLabel({ name: "Piet", email: "" }), "Piet");
});
test("a user is found by name, by email address or by the label from the list; who already has access is left out", () => {
  assert.deepEqual(C.matchUsers(PEOPLE, "piet"), ["uidPiet"]);
  assert.deepEqual(C.matchUsers(PEOPLE, " PIET@example.com "), ["uidPiet"]);
  assert.deepEqual(C.matchUsers(PEOPLE, "Piet <piet@example.com>"), ["uidPiet"]);
  assert.deepEqual(C.matchUsers(PEOPLE, "sam"), ["uidSam2", "uidSam"], "two people with that name: the page asks for the address");
  assert.deepEqual(C.matchUsers(PEOPLE, "sam@example.com"), ["uidSam"], "an exact address wins over a part of another");
  assert.deepEqual(C.matchUsers(PEOPLE, "example.com").length, 4);
  assert.deepEqual(C.matchUsers(PEOPLE, "an"), ["uidAnna", "uidSam2"], "a part of a name or an address");
  assert.deepEqual(C.matchUsers(PEOPLE, "piet", ["uidPiet"]), []);
  assert.deepEqual(C.matchUsers(PEOPLE, "sam", ["uidSam2"]), ["uidSam"]);
  for (const none of ["", "   ", "nobody", "odd@example.com", null]) assert.deepEqual(C.matchUsers(PEOPLE, none), [], String(none));
});
test("the line that says who owns a set and who it is shared with", () => {
  const m = C.newMeta({ name: "X", owner: "uidAnna" }, NOW);
  assert.equal(C.shareLine(m, PEOPLE), "Owner: Anna. Not shared");
  assert.equal(C.shareLine(C.withShare(C.withShare(m, "uidSam", true), "uidPiet", true), PEOPLE), "Owner: Anna. Shared with: Piet, Sam");
  assert.equal(C.shareLine(C.withShare({ ...m, owner: "uidGone" }, "uidLeft", true), PEOPLE), "Owner: a former user. Shared with: a former user");
  assert.equal(C.shareLine({ name: "Old" }, PEOPLE), "Owner: nobody. Not shared"); assert.equal(C.shareLine(null, PEOPLE), "");
  assert.equal(C.shareLine(C.withShare(m, "uidPiet", true), null), "Owner: a former user. Shared with: a former user", "before the list of users has arrived");
});

/* ---------- the admin's side: users and their sets (backlog H7) ---------- */
test("the sets a user owns; a set without owner belongs to nobody", () => {
  const sets = { b: { name: "B", owner: "uidPiet" }, a: { name: "A", owner: "uidPiet", shared: { uidSam: true } }, c: { name: "C", owner: "uidSam" }, old: { name: "Old" }, bad: null };
  assert.deepEqual(C.ownedIds(sets, "uidPiet"), ["a", "b"]); assert.deepEqual(C.ownedIds(sets, "uidAnna"), []);
  assert.deepEqual(C.ownedIds(sets, null), []); assert.deepEqual(C.ownedIds(null, "uidPiet"), []);
});
test("an admin changes the name and the role of a user, nothing else", () => {
  assert.deepEqual(C.userPatch({ name: "  Piet   de Vries ", role: "admin", email: "x@example.com", createdAt: 5 }), { name: "Piet de Vries", role: "admin" });
  assert.deepEqual(C.userPatch({ name: "  ", role: "presenter" }), {}, "an empty name and a role that does not exist change nothing");
  assert.equal(C.userPatch({ name: "n".repeat(100) }).name.length, 60); assert.deepEqual(C.userPatch(null), {});
});
test("an admin cannot remove or demote themself, so one admin is always left", () => {
  assert.match(C.selfChangeProblem("uidAnna", "uidAnna", "remove"), /own access/);
  assert.match(C.selfChangeProblem("uidAnna", "uidAnna", { role: "user" }), /own admin role/);
  assert.equal(C.selfChangeProblem("uidAnna", "uidAnna", { name: "Anna B", role: "admin" }), null, "the own name is fine");
  assert.equal(C.selfChangeProblem("uidAnna", "uidAnna", { name: "Anna B" }), null);
  assert.equal(C.selfChangeProblem("uidAnna", "uidPiet", "remove"), null); assert.equal(C.selfChangeProblem("uidAnna", "uidPiet", { role: "user" }), null);
});
test("removing a user's access: the record goes and the user leaves every shared list; the sets it owns are listed", () => {
  const sets = { a: { name: "A", owner: "uidAnna", shared: { uidPiet: true, uidSam: true } }, b: { name: "B", owner: "uidSam", shared: { uidPiet: true } }, c: { name: "C", owner: "uidAnna" } };
  assert.deepEqual(C.userRemoval("uidPiet", sets, { a: true, gone: true }), { owned: [], update: { "users/uidPiet": null, "userSets/uidPiet/a": null, "sets/a/shared/uidPiet": null,
    "userSets/uidPiet/b": null, "sets/b/shared/uidPiet": null, "userSets/uidPiet/gone": null } }, "b was not in the index; the set behind 'gone' no longer exists");
  assert.deepEqual(C.userRemoval("uidSam", sets, { a: true }).owned, ["b"], "still owns a set: the page refuses");
  assert.deepEqual(C.userRemoval("uidNew", null, null), { owned: [], update: { "users/uidNew": null } });
  assert.equal(C.ownsMessage("Sam", 1), "Sam still owns 1 question set. Assign it to another user first.");
  assert.equal(C.ownsMessage("Sam", 2), "Sam still owns 2 question sets. Assign them to another user first.");
});

/* ---------- onboarding (backlog H8) ---------- */
test("the password of a new account is 32 random characters and passes the own rule", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const p = C.randomPassword(); assert.equal(p.length, 32); assert.deepEqual(C.passwordProblems(p, "anna@example.com"), [], p); assert.match(p, /^[A-Za-z]\d/); seen.add(p); }
  assert.equal(seen.size, 200);
  for (const edge of [() => 0, () => 0.999999999, () => 1]) assert.equal(C.randomPassword(edge).length, 32);
});
test("a new user needs a name and a valid email address that is not in the list yet; the role is user unless it is admin", () => {
  const list = { u1: { email: "Piet@Example.com", name: "Piet", role: "user" } };
  assert.deepEqual(C.newUser({ name: "  Sam   de Vries ", email: " sam@example.com ", role: "admin", uid: "x" }, list, NOW), { user: { email: "sam@example.com", name: "Sam de Vries", role: "admin", createdAt: NOW } });
  assert.equal(C.newUser({ name: "Sam", email: "sam@example.com", role: "presenter" }, list, NOW).user.role, "user"); assert.equal(C.newUser({ name: "Sam", email: "sam@example.com" }, null, NOW).user.role, "user");
  assert.match(C.newUser({ name: " ", email: "sam@example.com" }, list, NOW).problem, /name/);
  for (const bad of ["", "sam", "sam@", "@example.com", "sam@example", "sam smit@example.com", "Sam <sam@example.com>", "a@b.c" + "d".repeat(200)]) assert.match(C.newUser({ name: "Sam", email: bad }, list, NOW).problem, /valid email/, bad);
  assert.match(C.newUser({ name: "Piet 2", email: "piet@example.COM" }, list, NOW).problem, /already a user/);
  assert.equal(C.emailOk("sam@example.com"), true); assert.equal(C.emailOk(null), false);
});
test("what Firebase Authentication refused, as a sentence; and which errors mean the link of a mail is dead", () => {
  const e = (code) => ({ code });
  assert.match(C.authProblem(e("auth/wrong-password")), /current password is not right/); assert.match(C.authProblem(e("auth/invalid-credential")), /current password is not right/);
  assert.match(C.authProblem(e("auth/too-many-requests")), /Too many attempts/); assert.match(C.authProblem(e("auth/network-request-failed")), /connect/);
  assert.match(C.authProblem(e("auth/weak-password")), /refused this password/); assert.match(C.authProblem(e("auth/password-does-not-meet-requirements")), /refused this password/);
  assert.match(C.authProblem(e("auth/email-already-in-use")), /already has an account/);
  assert.equal(C.authProblem(e("auth/expired-action-code")), null); assert.equal(C.authProblem(new Error("x")), null); assert.equal(C.authProblem(null), null);
  for (const dead of ["auth/expired-action-code", "auth/invalid-action-code", "auth/user-disabled", "auth/user-not-found"]) assert.equal(C.linkIsDead(e(dead)), true, dead);
  assert.equal(C.linkIsDead(e("auth/network-request-failed")), false); assert.equal(C.linkIsDead(null), false);
});
