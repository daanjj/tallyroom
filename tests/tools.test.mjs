import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, pageLink } from "../tools/password-link.mjs";

test("password-link: the command line gives an email address, the page and the key file", () => {
  const a = parseArgs(["anna@example.com"], {});
  assert.equal(a.email, "anna@example.com"); assert.equal(a.page, "https://daanjj.github.io/tallyroom/"); assert.match(a.key, /tools[\\/]service-account\.json$/);
  assert.deepEqual(parseArgs(["--page", "https://x.org/t/", "--key", "k.json", "b@x.org"], {}), { email: "b@x.org", page: "https://x.org/t/", key: "k.json" });
  const env = parseArgs(["b@x.org"], { TALLYROOM_PAGE: "https://y.org/", GOOGLE_APPLICATION_CREDENTIALS: "/k.json" }); assert.equal(env.page, "https://y.org/"); assert.equal(env.key, "/k.json");
  assert.match(parseArgs([], {}).problem, /email address/); assert.match(parseArgs(["nope"], {}).problem, /valid email/);
  assert.match(parseArgs(["a@x.org", "b@x.org"], {}).problem, /one email/); assert.match(parseArgs(["--page"], {}).problem, /needs a value/);
  assert.match(parseArgs(["--mail", "a@x.org"], {}).problem, /Unknown option/); assert.match(parseArgs(["a@x.org", "--page", "x.org"], {}).problem, /web address/);
  assert.equal(parseArgs(["--help"], {}).help, true);
});
test("password-link: the link opens the page's own Choose your password screen with Firebase's code, and nothing else", () => {
  const fb = "https://tallyroom-72b2d.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=AbC-12_x&apiKey=K&continueUrl=https%3A%2F%2Fz.org%2F%3Fhost%3D1&lang=en";
  assert.equal(pageLink("https://daanjj.github.io/tallyroom/?host=1#x", fb), "https://daanjj.github.io/tallyroom/?mode=resetPassword&oobCode=AbC-12_x");
  assert.throws(() => pageLink("https://x.org/", "https://x.org/?mode=resetPassword"), /no code/);
});
