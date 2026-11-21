/* Run with:  node --test
   Backlog G7: the page loads only its own scripts, and texts from a file or the database never turn into
   HTML or spreadsheet formulas in an export. tests/fixtures/hostile-set.json is also the set to import by hand
   and run through every phase in the browser (see README, "Hostile test set"). */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../js/core.js");

const root = path.join(__dirname, "..");
const IMG = "<img src=x onerror=alert(1)>", SCR = '"><script>alert(1)</script>';
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

test("index.html loads scripts from this site only, has no inline script, and carries the policy", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 8);
  for (const [, attrs, body] of scripts) {
    const src = (attrs.match(/src="([^"]+)"/) || [])[1];
    assert.ok(src, "inline script"); assert.equal(body.trim(), "");
    assert.doesNotMatch(src, /^(https?:)?\/\//, src);
    assert.ok(fs.existsSync(path.join(root, src.split("?")[0])), src + " is missing");
  }
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
  /* the site itself, plus reCAPTCHA for App Check (G6): Google serves it and it cannot be kept here */
  const scriptSrc = (csp.match(/script-src ([^;]+)/) || [])[1] || "";
  assert.deepEqual(scriptSrc.split(" "), ["'self'", "https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"]); assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(html, /\son[a-z]+="/); // no inline event handlers
});
test("the screens hold no inline event handlers (the policy would block them)", () => {
  assert.doesNotMatch(fs.readFileSync(path.join(root, "js/app.js"), "utf8"), /<[a-z][^>`]*\son[a-z]+=["'$]/);
});

/* a session on the hostile set: two named respondents with hostile comments, open answers and actions */
function hostileSession() {
  const imp = C.parseQuestionsFile(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/hostile-set.json"), "utf8")));
  const cfg = C.normConfig({ mode: "live", tlYellow: imp.tlYellow, tlRed: imp.tlRed, questions: imp.questions }), Q = cfg.questions;
  const meta = C.newMeta({ name: imp.set.name, header: imp.set.header, category: "consent", named: "yes" }, NOW);
  const vote = (name, a, t) => ({ round: 1, name, nameAt: 1, t, answers: { [Q[0].id]: a, [Q[1].id]: a, [Q[2].id]: 3, [Q[3].id]: 1, [Q[4].id]: 1 },
    texts: { [Q[0].id]: IMG + " remark", [Q[1].id]: SCR + " remark | with a pipe", [Q[4].id]: "=1+1" } });
  const votes = { d1: vote(IMG, 3, NOW - 2000), d2: vote("=cmd|' /C calc'!A0", 2, NOW - 1000) };
  const actions = { [C.actionKey(Q[0].id, "d1", 1)]: { action: SCR + " action", owner: "@" + IMG, due: "2026-12-01", none: false, t: NOW } };
  let ses = { ...C.DEFAULT_SESSION, phase: "summary", round: 1, revealed: Q.map((q) => q.id), outcome: {} };
  Q.forEach((qu) => { if (C.isTraffic(qu)) ses.outcome = C.fixOutcome(ses.outcome, qu, C.roundVotes(votes, 1, NOW, null, "yes"), NOW); });
  return { imp, payload: C.resultsPayload({ setId: "hostile", meta, cfg, ses, votes, actions, now: NOW }) };
}
test("the hostile set is read as text: every question keeps its payload literally", () => {
  const { imp } = hostileSession();
  assert.equal(imp.questions.length, 5); assert.ok(imp.questions.every((q) => /alert\(1\)/.test(q.text)));
  assert.equal(imp.set.category, "consent");
});
test("CSV: a cell that starts with = + - or @ gets an apostrophe, so a spreadsheet shows it as text", () => {
  assert.equal(C.csvCell("=1+1"), `"'=1+1"`); assert.equal(C.csvCell("+31 6"), `"'+31 6"`); assert.equal(C.csvCell("-x"), `"'-x"`); assert.equal(C.csvCell("@SUM(A1)"), `"'@SUM(A1)"`);
  assert.equal(C.csvCell("1+1=2"), `"1+1=2"`); assert.equal(C.csvCell('say "hi"'), `"say ""hi"""`); assert.equal(C.csvCell(null), `""`);
  const csv = C.resultsCSV(hostileSession().payload);
  assert.ok(csv.includes(`"'=1+1"`)); assert.ok(csv.includes(`"'=cmd|' /C calc'!A0"`)); assert.ok(csv.includes(`"'@<img`));
  for (const line of csv.split("\r\n")) for (const cell of line.split(/,(?=")/)) assert.doesNotMatch(cell, /^"[=+\-@]/, cell);
});
test("Markdown: no raw HTML from a text, and a pipe never splits a table cell", () => {
  const { payload } = hostileSession();
  for (const md of [C.consentMarkdown(payload), C.actionsMarkdown(payload)]) {
    assert.ok(md.includes("\\<img") && md.includes("\\<script>"), "the texts are there, escaped");
    assert.doesNotMatch(md, /(^|[^\\])<[a-z\/]/i);
    for (const row of md.split("\n").filter((l) => l.startsWith("| ") && /remark/.test(l))) assert.doesNotMatch(row.replace(/\\\|/g, ""), /with a pipe \|.*with a pipe/);
    assert.ok(md.includes("remark \\| with a pipe") || !/with a pipe/.test(md.split("## Overview")[0]));
  }
});
test("a question from the database or a file has numbers where the screens expect numbers", () => {
  const cfg = C.normConfig({ questions: [{ id: 7, text: "x", min: IMG, max: "9" + IMG, rev: SCR, maxLen: IMG, conf: { min: IMG, max: 1e9 },
    history: { a: { rev: IMG, text: 5, counts: { g: SCR, y: "2" }, comments: { b: { v: IMG, text: 9, name: 3 } } } } }] });
  const q = cfg.questions[0], h = q.history[0];
  assert.deepEqual([q.id, q.min, q.max, q.rev, q.maxLen, q.conf.min, q.conf.max], ["7", 1, 5, 1, 500, 1, 11]);
  assert.deepEqual([h.rev, h.text, h.counts, h.comments], [1, "5", { g: 0, y: 2, r: 0 }, [{ v: 0, text: "9", name: "3" }]]);
  const r = C.reviveQuestion({ id: SCR, text: "p", kind: "traffic", rev: "3", history: [{ rev: IMG, counts: { r: IMG } }] }, 0);
  assert.equal(r.rev, 3); assert.equal(r.history[0].rev, 1); assert.equal(r.history[0].counts.r, 0);
  assert.deepEqual(C.reviveOutcome({ questions: [{ id: "q", kind: "traffic", status: "red", lights: { g: IMG, r: 2 } }] }).q.counts, { g: 0, y: 0, r: 2 });
});
test("the rules in tallyroom-setup.md are the same as database.rules.json", () => {
  const md = fs.readFileSync(path.join(root, "tallyroom-setup.md"), "utf8"), m = md.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(m, "no rules block in tallyroom-setup.md");
  assert.deepEqual(JSON.parse(m[1]), JSON.parse(fs.readFileSync(path.join(root, "database.rules.json"), "utf8")));
});
test("the rules check every per-question answer key against the question list of the set", () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, "database.rules.json"), "utf8")).rules.polls.$set.votes.$uid;
  for (const k of ["answers", "conf", "revs", "texts", "typing"]) assert.match(v[k].$q[".validate"], /child\('qids'\)\.child\(\$q\)/, k);
  for (const k of ["answers", "conf"]) assert.match(v[k].$q[".validate"], /newData\.val\(\) >= 0 && newData\.val\(\) <= 11/, k);
});
test("the rules let a participant read its own answers only; the room reads shown/ and names/", () => {
  const ps = JSON.parse(fs.readFileSync(path.join(root, "database.rules.json"), "utf8")).rules.polls.$set;
  assert.equal(ps.votes[".read"], undefined, "no read rule on votes below the presenter's");
  assert.equal(ps.votes.$uid[".read"], "auth != null && auth.uid === $uid");
  assert.equal(ps.shown[".read"], "auth != null"); assert.equal(ps.shown[".write"], undefined, "only a presenter writes shown/");
  assert.match(ps.names.$uid[".write"], /auth\.uid === \$uid/); assert.equal(ps.names.$uid.$other[".validate"], false);
});
