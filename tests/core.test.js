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
test("set id: 8 characters from a-z0-9, valid as ?set= value", () => {
  for (let i = 0; i < 200; i++) { const id = C.newSetId(); assert.match(id, /^[a-z0-9]{8}$/); assert.ok(C.SET_ID_RE.test(id)); }
  assert.equal(C.newSetId(() => 0), "aaaaaaaa");
  assert.equal(C.newSetId(() => 0.999999), "99999999");
});
test("set id pattern refuses characters that break a database path", () => {
  for (const bad of ["a/b", "a.b", "a b", "", "a#b", "x".repeat(41)]) assert.equal(C.SET_ID_RE.test(bad), false, bad);
  assert.ok(C.SET_ID_RE.test("workshop-4"));
});
test("new set: defaults are purple, generic, anonymous, 3 days", () => {
  const m = C.newMeta({ name: " Team B " }, NOW);
  assert.deepEqual(m, { name: "Team B", header: "Team B", accent: "#5A3BD6", category: "generic", named: "no",
    expiresAt: NOW + 3 * C.DAY, joinUrl: "", createdAt: NOW, updatedAt: NOW });
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
  assert.equal(csv[0], "respondent,question_nr,question,value,label,comment,set,header,category");
  assert.ok(csv.includes('"R02",1,"Proposal",3,"Bezwaar","Too costly","Team B","Team B session","consent"'));
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
test("D1 random names: letter plus two digits, unique within the set", () => {
  assert.equal(C.randomName(new Set(), seq(1 / 26 + 0.001, 0.59)), "b59");
  assert.equal(C.randomName([], seq(15 / 26 + 0.001, 0.03)), "p03");
  assert.equal(C.randomName(new Set(["b59"]), seq(1 / 26 + 0.001, 0.59, 10 / 26 + 0.001, 0.12)), "k12", "draws again on a collision");
  const taken = new Set();
  for (let i = 0; i < 300; i++) { const n = C.randomName(taken); assert.match(n, /^[a-z][0-9]{2}$/); assert.ok(!taken.has(n)); taken.add(n); }
  const all = new Set(); for (let l = 0; l < 26; l++) for (let n = 0; n < 100; n++) all.add(String.fromCharCode(97 + l) + String(n).padStart(2, "0"));
  assert.equal(C.randomName(all), null, "all 2,600 names in use");
  all.delete("z99"); assert.equal(C.randomName(all), "z99", "finds the last free name");
});
