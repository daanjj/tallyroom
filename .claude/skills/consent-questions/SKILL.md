---
name: consent-questions
description: Create a Tallyroom questions file (JSON) for a consent round from a list of questions, one per line, ready to import via "New question set → Create from file". Use when the user wants to make/convert consent questions or a consent set for Tallyroom.
---

# Consent questions → Tallyroom import file

Tallyroom's "Create from file" reads a JSON object:

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
2. Save the pasted lines to a temporary text file (e.g. `questions.txt`).
3. Run `make_questions.py`, which sits in the same folder as this `SKILL.md`. Use that folder's real path for `SKILL_DIR`; the skill works from any location and does not need the Tallyroom repository:
   ```bash
   python3 SKILL_DIR/make_questions.py questions.txt YYYYMMDD-tallyroom-questions.json --name "NAME" [--header "…"] [--named yes] [--yellow "…"] [--red "…"]
   ```
   Use today's date as the prefix. Write the output where the user can reach it: the current working directory, or, in a chat without a working directory, the folder for downloadable files, and offer the file for download.
4. Report the path and question count, and say: New question set → Create from file → pick the file (category Consent is set by the file). Questions are kept verbatim; don't rewrite them.
