# Rules checklist

`tests/rules.test.js` tries `database.rules.json` against every row of the rights table (backlog H4), but with a stand-in for Firebase. After publishing the rules, try the cases below on the real database, in **Realtime Database → Rules → Rules Playground** or from the browser console of the page, and note the date and outcome here.

Needed: an admin, two users (A and B), an account without a `users` record, and a phone. A owns one private set shared with B, and one public set.

| # | Who | Tries | Must be |
|---|---|---|---|
| 1 | Not signed in | read `sets/{id}`; write anything | refused |
| 2 | Phone (anonymous) | read `sets/{id}`, `polls/{id}/config`; write its own vote | allowed |
| 3 | Phone | read `sets`, `users`, `polls/{id}/votes`; write `polls/{id}/session` | refused |
| 4 | Account without record | sign in | "This account has no access" |
| 5 | User B | overview query on own sets and on public sets | allowed, and the queries need no index warning in the console |
| 6 | User B | read `sets` without a query | refused |
| 7 | User B, on A's private shared set | edit a question, run a session, read the answers | allowed |
| 8 | User B, on that set | delete, change link, switch to public, share with someone | refused |
| 9 | User B, on A's public set | read `polls/{id}/config` | allowed |
| 10 | User B, on A's public set | read `polls/{id}/votes`; write `polls/{id}/config` | refused |
| 11 | User A | create, duplicate, change link and delete an own set | allowed, and after delete `polls/{id}` is gone too |
| 12 | User A | write `sets/{own id}/owner` with B's uid; write `users/{own uid}/role` | refused |
| 13 | Admin | all of 7, 8 and 12 on A's sets | allowed |
| 14 | Three phones | a full session in a consent set | no refused write in the console |

## Log

| Date | Rules of commit | Outcome |
|---|---|---|
| | | not tried yet |
