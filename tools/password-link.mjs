#!/usr/bin/env node
/* The link of a password mail, without the mail: for an admin to send it in another way, for example in WhatsApp, when the
   mail does not arrive. It opens the page's Choose your password screen, works once and for about an hour (Firebase decides).

   Runs on the admin's own computer with the Firebase Admin SDK and a service-account key (tallyroom-setup.md, step 1b.9).
   That key gives full control over the Firebase project: it stays on this computer and is never committed (.gitignore).

     cd tools && npm install                          once
     node tools/password-link.mjs anna@example.com    prints the link; add  | pbcopy  to put it on the clipboard (Mac)

   Options: --page <address of the page>   (default below, or TALLYROOM_PAGE)
            --key <service-account file>    (default tools/service-account.json, or GOOGLE_APPLICATION_CREDENTIALS) */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

/* the address of your page, as in step 3 of tallyroom-setup.md */
const DEFAULT_PAGE = "https://daanjj.github.io/tallyroom/";
const HERE = dirname(fileURLToPath(import.meta.url));

/* the command line -> {email, page, key} or {problem} */
export function parseArgs(argv, env = {}) {
  const out = { email: "", page: env.TALLYROOM_PAGE || DEFAULT_PAGE, key: env.GOOGLE_APPLICATION_CREDENTIALS || join(HERE, "service-account.json") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--page" || a === "--key") { const v = argv[++i]; if (!v) return { problem: `${a} needs a value` }; out[a.slice(2)] = v; }
    else if (a === "-h" || a === "--help") return { help: true };
    else if (a.startsWith("-")) return { problem: `Unknown option ${a}` };
    else if (out.email) return { problem: "Give one email address" };
    else out.email = a.trim();
  }
  if (!out.email) return { problem: "Give the email address of the user" };
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(out.email)) return { problem: `Not a valid email address: ${out.email}` };
  if (!/^https?:\/\//.test(out.page)) return { problem: `The page must be a web address: ${out.page}` };
  return out;
}

/* the link to the page's own Choose your password screen, with the code of the link Firebase made */
export function pageLink(page, firebaseLink) {
  const code = new URL(firebaseLink).searchParams.get("oobCode");
  if (!code) throw new Error("The link from Firebase holds no code");
  const p = new URLSearchParams({ mode: "resetPassword", oobCode: code });
  return String(page).split(/[?#]/)[0] + "?" + p.toString();
}

const USAGE = "Usage: node tools/password-link.mjs <email> [--page <address of the page>] [--key <service-account file>]";

async function main() {
  const a = parseArgs(process.argv.slice(2), process.env);
  if (a.help) { console.log(USAGE); return; }
  if (a.problem) { console.error(a.problem + "\n" + USAGE); process.exitCode = 2; return; }
  const keyFile = resolve(a.key);
  if (!existsSync(keyFile)) { console.error(`No service-account key at ${keyFile}. Make one as in tallyroom-setup.md, step 1b.9.`); process.exitCode = 2; return; }
  let app, authOf;
  try { app = await import("firebase-admin/app"); authOf = (await import("firebase-admin/auth")).getAuth; }
  catch (e) { console.error("The Firebase Admin SDK is not installed. Run once:  cd tools && npm install"); process.exitCode = 2; return; }
  const key = JSON.parse(readFileSync(keyFile, "utf8"));
  const fb = app.initializeApp({ credential: app.cert(key) }), auth = authOf(fb);
  try {
    const user = await auth.getUserByEmail(a.email);
    if (user.disabled) { console.error(`The account of ${a.email} is switched off in Firebase Authentication.`); process.exitCode = 1; return; }
    const link = pageLink(a.page, await auth.generatePasswordResetLink(a.email));
    console.error(`Password link for ${user.displayName || a.email} (project ${key.project_id}). It works once and for about an hour:`);
    console.log(link);
  } catch (e) {
    const code = String((e && e.code) || "");
    if (/user-not-found/.test(code)) console.error(`${a.email} has no account in Firebase Authentication of project ${key.project_id}. Add the user on the Users screen.`);
    else console.error("Firebase refused: " + ((e && e.message) || e));
    process.exitCode = 1;
  } finally { await app.deleteApp(fb); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
