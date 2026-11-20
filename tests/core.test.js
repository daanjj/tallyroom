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
  assert.equal(csv[0], "respondent,question_nr,question,value,label,comment,confidence,set,header,category");
  assert.ok(csv.includes('"R02",1,"Proposal",3,"Bezwaar","Too costly",,"Team B","Team B session","consent"'));
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
  assert.deepEqual(C.questionProblems([C.qNew("options"), s, C.qNew("dilemma"), d]), ["Question 1: add at least two options.", "Question 3: add at least two options."]);
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
  const cfg = { questions: [C.qOpen("Why?", 300), C.qDilemma("Which?", ["Left", "Right", "Wait"], { text: "Sure?", min: 1, max: 7, lo: "no", hi: "yes" })] };
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
  assert.equal(new Set(names).size, 30); names.forEach(n => assert.match(n, /^[a-z][0-9]{2}$/));
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
