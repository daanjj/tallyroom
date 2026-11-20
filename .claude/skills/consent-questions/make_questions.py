#!/usr/bin/env python3
"""Build a Tallyroom consent questions file from a text file (one question per line).

usage: make_questions.py INPUT.txt OUTPUT.json [--name NAME] [--header HEADER]
                         [--named no|yes] [--yellow TEXT] [--red TEXT]
"""
import argparse, json, re

p = argparse.ArgumentParser()
p.add_argument("input"); p.add_argument("output")
p.add_argument("--name", default="Consent round")
p.add_argument("--header", default="")
p.add_argument("--named", default="no", choices=["no", "yes"])
p.add_argument("--yellow", default="Welke zorg heb je en wat stel je voor om te doen?")
p.add_argument("--red", default="Welk bezwaar heb je en wat is je voorstel om dat bezwaar te adresseren?")
a = p.parse_args()

lines = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", l).strip() for l in open(a.input, encoding="utf-8")]
texts = [l for l in lines if l]
if not texts:
    raise SystemExit("no questions found")

doc = {
    "set": {"name": a.name, "header": a.header or a.name, "category": "consent", "named": a.named},
    "followUps": {"yellow": a.yellow, "red": a.red},
    "questions": [{"text": t, "kind": "traffic", "options": ["Consent", "Zorg", "Bezwaar"]} for t in texts],
}
with open(a.output, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1); f.write("\n")
print(f"{len(texts)} questions -> {a.output}")
