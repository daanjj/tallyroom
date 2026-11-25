#!/bin/bash
# Asks for the email address of a user, makes the link of a password mail without the mail (password-link.mjs) and puts it
# on the clipboard, ready to paste in WhatsApp. Mac only (pbcopy). Setup: tallyroom-setup.md, step 1b.9.
#   tools/password-link.sh
cd "$(dirname "$0")" || exit 1
command -v pbcopy >/dev/null || { echo "No clipboard command (pbcopy): this script is for a Mac."; exit 1; }
command -v node >/dev/null || { echo "Node.js is not installed (tallyroom-setup.md, step 1b.9)."; exit 1; }

read -r -p "Email address of the user: " email
email="$(printf '%s' "$email" | tr -d '[:space:]')"
[ -n "$email" ] || { echo "No email address given. Nothing done."; exit 1; }

# the link goes to stdout; messages go to stderr, without the deprecation warning of a Google library
errfile="$(mktemp)"; trap 'rm -f "$errfile"' EXIT
link="$(node password-link.mjs "$email" 2>"$errfile")"; status=$?
grep -v -e 'fromJSON` method is deprecated' "$errfile" | grep -v -e '^Password link for ' >&2

if [ $status -ne 0 ] || [ -z "$link" ]; then echo "No link made for $email."; exit 1; fi
printf '%s' "$link" | pbcopy || { echo "Copying to the clipboard failed. The link:"; echo "$link"; exit 1; }
echo "Done: the password link for $email is on the clipboard."
echo "It works once and for about an hour. Send it to $email only: whoever has it can take the account."
