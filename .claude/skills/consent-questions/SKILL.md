---
name: consent-questions
description: Create a Tallyroom questions file (JSON) for a consent round from a list of questions, one per line, ready to import via "New question set → Create from file". Use when the user wants to make/convert consent questions or a consent set for Tallyroom.
---

# Consent questions → Tallyroom import file

Tallyroom's "Create from file" reads a JSON object (`parseQuestionsFile` in `js/core.js`):

```json
{
 "set": {"name": "…", "header": "…", "category": "consent", "named": "no"},
 "followUps": {"yellow": "…", "red": "…"},
 "questions": [{"text": "…", "kind": "traffic", "options": ["Consent", "Zorg", "Bezwaar"]}]
}
```

`set` is optional metadata (`accent` hex is optional too); `followUps` are the written follow-up questions shown for a yellow (Zorg) / red (Bezwaar) light.

## Steps

1. Ask the user to paste their consent questions, one per line (bullets/numbering are stripped). Also ask, in the same message, for: a set name (default "Consent round"), optional header, and whether votes are named (`named`: "no" = anonymous, default). Keep the default Dutch follow-ups unless they want others.
2. Save the pasted lines to a scratchpad text file (e.g. `questions.txt`).
3. Run:
   ```bash
   python3 .claude/skills/consent-questions/make_questions.py questions.txt YYYYMMDD-tallyroom-questions.json --name "NAME" [--header "…"] [--named yes] [--yellow "…"] [--red "…"]
   ```
   Write the output in the repo root (today's date as prefix, like the existing `2026…-tallyroom-questions.json` files).
4. Report the path and question count, and say: New question set → Create from file → pick the file (category Consent is set by the file). Questions are kept verbatim; don't rewrite them.
